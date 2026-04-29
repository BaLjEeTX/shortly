package com.shortly.api.exception;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;
import java.util.Map;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    private static final String ERROR_BASE = "https://shortly.app/errors/";

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> handleValidation(
            MethodArgumentNotValidException ex, HttpServletRequest req) {
        ProblemDetail pd = build(HttpStatus.BAD_REQUEST,
            "Validation failed", "validation", req);
        pd.setProperty("errors", ex.getBindingResult().getFieldErrors().stream()
            .map(e -> Map.of("field", e.getField(),
                             "message", e.getDefaultMessage()))
            .toList());
        return ResponseEntity.badRequest().body(pd);
    }

    @ExceptionHandler({UrlNotFoundException.class, ShortCodeNotFoundException.class})
    public ResponseEntity<ProblemDetail> handleNotFound(
            RuntimeException ex, HttpServletRequest req) {
        ProblemDetail pd = build(HttpStatus.NOT_FOUND,
            ex.getMessage(), "not-found", req);
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(pd);
    }

    @ExceptionHandler(BlockedDomainException.class)
    public ResponseEntity<ProblemDetail> handleBlocked(
            BlockedDomainException ex, HttpServletRequest req) {
        ProblemDetail pd = build(HttpStatus.FORBIDDEN,
            "Domain is blocked: " + ex.getDomain(), "blocked-domain", req);
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(pd);
    }

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ProblemDetail> handleAuth(
            BadCredentialsException ex, HttpServletRequest req) {
        ProblemDetail pd = build(HttpStatus.UNAUTHORIZED,
            "Invalid credentials", "auth", req);
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(pd);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ProblemDetail> handleForbidden(
            AccessDeniedException ex, HttpServletRequest req) {
        ProblemDetail pd = build(HttpStatus.FORBIDDEN,
            "Access denied", "forbidden", req);
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(pd);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleGeneric(
            Exception ex, HttpServletRequest req) {
        // Log full stack trace; return only generic message to client
        log.error("Unhandled exception on path {}: ", req.getRequestURI(), ex);
        ProblemDetail pd = build(HttpStatus.INTERNAL_SERVER_ERROR,
            "An unexpected error occurred", "internal", req);
        return ResponseEntity.internalServerError().body(pd);
    }

    private ProblemDetail build(HttpStatus status, String detail, String slug,
                                 HttpServletRequest req) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status, detail);
        pd.setType(URI.create(ERROR_BASE + slug));
        pd.setTitle(status.getReasonPhrase());
        pd.setInstance(URI.create(req.getRequestURI()));
        pd.setProperty("traceId", MDC.get("traceId"));
        return pd;
    }
}
