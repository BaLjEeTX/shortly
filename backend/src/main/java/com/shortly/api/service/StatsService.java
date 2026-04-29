package com.shortly.api.service;

import com.shortly.api.dto.response.StatsResponse;
import com.shortly.api.repository.UrlStatsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Map;

import com.shortly.api.repository.ClickEventRepository;

@Service
@RequiredArgsConstructor
public class StatsService {
    private final UrlStatsRepository urlStatsRepository;
    private final ClickEventRepository clickEventRepository;
    
    public StatsResponse getStats(Long urlId) {
        return new StatsResponse(urlStatsRepository.findClickCountByUrlId(urlId).orElse(0L));
    }
    
    public List<Map<String, Object>> getTimeSeries(Long urlId) {
        return clickEventRepository.getTimeSeries(urlId);
    }
    
    public List<Map<String, Object>> getReferrers(Long urlId) {
         return clickEventRepository.getTopReferrers(urlId);
    }
}
