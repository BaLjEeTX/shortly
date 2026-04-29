package com.shortly.api.service;

import org.springframework.stereotype.Component;

@Component
public class Base62Codec {

    private static final String ALPHABET =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private static final int BASE = ALPHABET.length();

    /**
     * Encodes a positive long ID into a Base62 string.
     * IDs grow naturally: 0 → "0", 61 → "z", 62 → "10", etc.
     */
    public String encode(long id) {
        if (id < 0) throw new IllegalArgumentException("id must be non-negative");
        if (id == 0) return String.valueOf(ALPHABET.charAt(0));
        StringBuilder sb = new StringBuilder();
        while (id > 0) {
            sb.append(ALPHABET.charAt((int) (id % BASE)));
            id /= BASE;
        }
        return sb.reverse().toString();
    }

    /** Decode is useful for tests and admin tooling. */
    public long decode(String s) {
        long result = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            int value = ALPHABET.indexOf(c);
            if (value < 0) throw new IllegalArgumentException("invalid char: " + c);
            result = result * BASE + value;
        }
        return result;
    }
}
