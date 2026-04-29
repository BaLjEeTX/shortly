package com.shortly.api.service;

import com.shortly.api.domain.ClickEvent;
import com.shortly.api.repository.ClickEventRepository;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

@Component
@Slf4j
public class ClickEventBuffer {

    private final BlockingQueue<ClickEvent> queue;
    private final ClickEventRepository repository;
    private final MeterRegistry meterRegistry;
    private final int batchSize;

    public ClickEventBuffer(
            ClickEventRepository repository,
            MeterRegistry meterRegistry,
            @Value("${app.click-buffer.capacity}") int capacity,
            @Value("${app.click-buffer.batch-size}") int batchSize) {
        this.repository = repository;
        this.meterRegistry = meterRegistry;
        this.queue = new LinkedBlockingQueue<>(capacity);
        this.batchSize = batchSize;

        // Expose queue depth as a gauge
        meterRegistry.gauge("click_buffer.depth", queue, BlockingQueue::size);
    }

    public void record(ClickEvent event) {
        boolean accepted = queue.offer(event);
        if (!accepted) {
            meterRegistry.counter("click_buffer.dropped").increment();
        } else {
            meterRegistry.counter("click_buffer.accepted").increment();
        }
    }

    @Scheduled(fixedDelayString = "${app.click-buffer.flush-interval-ms}")
    @Transactional
    public void flush() {
        List<ClickEvent> batch = new ArrayList<>(batchSize);
        queue.drainTo(batch, batchSize);
        if (batch.isEmpty()) return;

        try {
            repository.batchInsert(batch);
            meterRegistry.counter("click_buffer.flushed").increment(batch.size());
        } catch (Exception e) {
            log.error("Failed to flush click events batch of size {}", batch.size(), e);
            meterRegistry.counter("click_buffer.flush_errors").increment();
        }
    }

    /**
     * On graceful shutdown, flush remaining events to avoid losing data.
     */
    @PreDestroy
    public void onShutdown() {
        log.info("Shutting down: flushing {} pending click events", queue.size());
        while (!queue.isEmpty()) flush();
    }
}
