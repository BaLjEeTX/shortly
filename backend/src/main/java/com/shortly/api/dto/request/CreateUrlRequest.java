package com.shortly.api.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateUrlRequest(
    @NotBlank @Size(max = 2048) @org.hibernate.validator.constraints.URL String longUrl,
    @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(5) Integer durationMinutes
) {}
