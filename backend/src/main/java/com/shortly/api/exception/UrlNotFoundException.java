package com.shortly.api.exception;

public class UrlNotFoundException extends RuntimeException {
    public UrlNotFoundException(Long id) {
        super("URL not found with id: " + id);
    }
}
