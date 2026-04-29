package com.shortly.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class ShortlyApplication {
    public static void main(String[] args) {
        SpringApplication.run(ShortlyApplication.class, args);
    }
}
