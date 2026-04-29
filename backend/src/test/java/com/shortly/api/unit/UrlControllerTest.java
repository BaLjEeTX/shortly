package com.shortly.api.unit;

import com.shortly.api.controller.UrlController;
import com.shortly.api.service.UrlService;
import com.shortly.api.dto.response.UrlResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;
import java.time.Instant;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

// Test the controller in isolation; service is mocked
@WebMvcTest(UrlController.class)
@AutoConfigureMockMvc(addFilters = false)  // skip security here
class UrlControllerTest {

    @Autowired MockMvc mvc;
    @MockBean UrlService urlService;
    @MockBean com.shortly.api.security.JwtService jwtService;
    @MockBean com.shortly.api.security.JwtAuthFilter jwtAuthFilter;

    @Test
    void create_returns201_andLocationHeader() throws Exception {
        when(urlService.create(any(), any()))
            .thenReturn(new UrlResponse(42L, "3D7", "http://x/3D7", "https://e.com",
                                         null, Instant.now(), 0L));

        mvc.perform(post("/api/v1/urls")
                .contentType(APPLICATION_JSON)
                .content("""
                    {"longUrl":"https://example.com"}
                """))
           .andExpect(status().isCreated())
           .andExpect(header().exists("Location"))
           .andExpect(jsonPath("$.shortCode").value("3D7"));
    }

    @Test
    void create_returns400_onInvalidUrl() throws Exception {
        mvc.perform(post("/api/v1/urls")
                .contentType(APPLICATION_JSON)
                .content("{\"longUrl\":\"not-a-url\"}"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.errors").isArray());
    }
}
