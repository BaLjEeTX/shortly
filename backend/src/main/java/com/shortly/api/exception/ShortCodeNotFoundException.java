package com.shortly.api.exception;

public class ShortCodeNotFoundException extends RuntimeException {
    public ShortCodeNotFoundException(String code) {
        super("URL not found for code: " + code);
    }
}
