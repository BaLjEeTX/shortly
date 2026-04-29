package com.shortly.api.exception;

public class BlockedDomainException extends RuntimeException {
    private final String domain;
    public BlockedDomainException(String domain) {
        super("Domain is blocked: " + domain);
        this.domain = domain;
    }
    public String getDomain() { return domain; }
}
