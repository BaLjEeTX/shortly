package com.shortly.api.security;

import com.shortly.api.domain.User;
import com.shortly.api.repository.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.SimpleUrlAuthenticationSuccessHandler;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.util.Optional;

@Component
@RequiredArgsConstructor
public class OAuth2LoginSuccessHandler extends SimpleUrlAuthenticationSuccessHandler {

    private final JwtService jwtService;
    private final UserRepository userRepository;

    @org.springframework.beans.factory.annotation.Value("${app.frontend-url:http://localhost:5174}")
    private String frontendUrl;

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response, Authentication authentication) throws IOException {
        OAuth2User oAuth2User = (OAuth2User) authentication.getPrincipal();
        String email = oAuth2User.getAttribute("email");
        String name = oAuth2User.getAttribute("name");
        String providerId = oAuth2User.getName(); // Usually the sub field for google

        User user = userRepository.findByEmailIgnoreCase(email).orElseGet(() -> {
            User newUser = new User();
            newUser.setEmail(email);
            newUser.setDisplayName(name);
            newUser.setProvider("google");
            newUser.setProviderId(providerId);
            // No password hash is set
            return userRepository.save(newUser);
        });

        // Generate JWT
        String token = jwtService.generateAccessToken(user);

        // Redirect to frontend
        String targetUrl = UriComponentsBuilder.fromUriString(frontendUrl + "/oauth2/callback")
                .queryParam("token", token)
                .build().toUriString();

        getRedirectStrategy().sendRedirect(request, response, targetUrl);
    }
}
