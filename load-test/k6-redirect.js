// load-test/k6-redirect.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 },   // ramp to 100 vus
    { duration: '2m',  target: 500 },   // sustain
    { duration: '1m',  target: 1000 },  // peak
    { duration: '30s', target: 0 },     // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(99)<30'],    // P99 under 30ms
    http_req_failed:   ['rate<0.001'],  // <0.1% errors
  },
};

const codes = ['3D7', '4E8', '5F9', '6Ga', '7Hb'];  // pre-seeded

export default function () {
  const code = codes[Math.floor(Math.random() * codes.length)];
  const res = http.get(`http://localhost:8080/${code}`, { redirects: 0 });
  check(res, { 'is 302': (r) => r.status === 302 });
}
