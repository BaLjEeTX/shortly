package com.shortly.api.integration;

import com.jayway.jsonpath.JsonPath;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import java.util.Map;
import static org.hamcrest.Matchers.endsWith;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@Testcontainers
@AutoConfigureMockMvc
class UrlShortenerEndToEndIT {

    @Container
    static PostgreSQLContainer<?> postgres =
        new PostgreSQLContainer<>("postgres:16-alpine");

    @Container
    static GenericContainer<?> redis =
        new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry reg) {
        reg.add("spring.datasource.url", postgres::getJdbcUrl);
        reg.add("spring.datasource.username", postgres::getUsername);
        reg.add("spring.datasource.password", postgres::getPassword);
        reg.add("spring.data.redis.host", redis::getHost);
        reg.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;

    private String tokenForUser(String email) throws Exception {
        // Register
        mvc.perform(post("/api/v1/auth/register")
            .contentType(APPLICATION_JSON)
            .content(om.writeValueAsString(Map.of(
                "email", email, "password", "Password1!", "displayName", "T"))))
           .andExpect(status().isOk());

        // Login
        var res = mvc.perform(post("/api/v1/auth/login")
            .contentType(APPLICATION_JSON)
            .content(om.writeValueAsString(Map.of(
                "email", email, "password", "Password1!"))))
           .andExpect(status().isOk()).andReturn();
        return JsonPath.read(res.getResponse().getContentAsString(), "$.accessToken");
    }

    @Test
    void fullFlow_create_then_redirect_then_stats() throws Exception {
        String token = tokenForUser("alice@test.com");

        // Create
        var createRes = mvc.perform(post("/api/v1/urls")
            .header("Authorization", "Bearer " + token)
            .contentType(APPLICATION_JSON)
            .content("{\"longUrl\":\"https://example.com/page\"}"))
           .andExpect(status().isCreated())
           .andReturn();
        String shortCode = JsonPath.read(
            createRes.getResponse().getContentAsString(), "$.shortCode");

        // Redirect (no auth needed)
        mvc.perform(get("/" + shortCode))
           .andExpect(status().isFound())
           .andExpect(header().string("Location", "https://example.com/page"));

        // Wait for the click event flush (or trigger flush manually in test)
        Thread.sleep(1500);

        // Stats reflect the click
        Long urlId = ((Number) JsonPath.read(
            createRes.getResponse().getContentAsString(), "$.id")).longValue();
        mvc.perform(get("/api/v1/urls/" + urlId + "/stats")
            .header("Authorization", "Bearer " + token))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.clickCount").value(1));
    }

    @Test
    void redirect_unknownCode_returns404() throws Exception {
        mvc.perform(get("/nonexistent"))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.type").value(endsWith("/not-found")));
    }

    @Test
    void otherUser_cannotAccessMyUrl() throws Exception {
        String tokenA = tokenForUser("a@test.com");
        String tokenB = tokenForUser("b@test.com");

        var createRes = mvc.perform(post("/api/v1/urls")
            .header("Authorization", "Bearer " + tokenA)
            .contentType(APPLICATION_JSON)
            .content("{\"longUrl\":\"https://secret.com\"}"))
           .andReturn();
        Long urlId = ((Number) JsonPath.read(
            createRes.getResponse().getContentAsString(), "$.id")).longValue();

        // User B should get 404 (not 403, to prevent enumeration)
        mvc.perform(get("/api/v1/urls/" + urlId)
            .header("Authorization", "Bearer " + tokenB))
           .andExpect(status().isNotFound());
    }
}
