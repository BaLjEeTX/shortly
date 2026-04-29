package com.shortly.api.exception;

public class DuplicateUrlException extends RuntimeException {
    public DuplicateUrlException(String msg) { super(msg); }
}
