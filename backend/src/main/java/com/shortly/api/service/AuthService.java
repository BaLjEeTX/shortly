package com.shortly.api.service;

import com.shortly.api.domain.User;
import com.shortly.api.dto.request.LoginRequest;
import com.shortly.api.dto.request.RegisterRequest;
import com.shortly.api.dto.response.TokenResponse;
import com.shortly.api.repository.UserRepository;
import com.shortly.api.security.JwtService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthService {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public TokenResponse register(RegisterRequest req) {
        if (userRepository.existsByEmailIgnoreCase(req.email())) {
            throw new IllegalArgumentException("Email already in use");
        }
        User user = User.builder()
            .email(req.email().toLowerCase())
            .passwordHash(passwordEncoder.encode(req.password()))
            .displayName(req.displayName())
            .role(User.Role.USER)
            .enabled(true)
            .build();
        user = userRepository.save(user);
        return TokenResponse.of(jwtService.generateAccessToken(user), "dummy-refresh-token", user);
    }

    public TokenResponse login(LoginRequest req) {
        User user = userRepository.findByEmailIgnoreCase(req.email())
            .orElseThrow(() -> new BadCredentialsException("Bad credentials"));
        if (!passwordEncoder.matches(req.password(), user.getPasswordHash())) {
            throw new BadCredentialsException("Bad credentials");
        }
        return TokenResponse.of(jwtService.generateAccessToken(user), "dummy-refresh-token", user);
    }
}
