package com.shortly.api.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateUrlRequest(
    @NotBlank @Size(max = 2048) @org.hibernate.validator.constraints.URL String longUrl
) {}
