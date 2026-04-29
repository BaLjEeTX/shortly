package com.shortly.api.dto.response;

import com.shortly.api.domain.User;

public record TokenResponse(
    String accessToken,
    String refreshToken,
    UserDto user
) {
    public record UserDto(Long id, String email, String displayName) {}
    
    public static TokenResponse of(String access, String refresh, User user) {
        return new TokenResponse(access, refresh, new UserDto(user.getId(), user.getEmail(), user.getDisplayName()));
    }
}
