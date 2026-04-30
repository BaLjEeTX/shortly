#!/bin/bash
set -e

EMAIL="statstest_$RANDOM@example.com"
# Register
RES=$(curl -s -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\", \"password\":\"Password1!\", \"displayName\":\"Stats User\"}")
TOKEN=$(echo $RES | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

# Create URL
RES2=$(curl -s -X POST http://localhost:8080/api/v1/urls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"longUrl":"https://news.ycombinator.com"}')
URL_ID=$(echo $RES2 | grep -o '"id":[0-9]*' | cut -d':' -f2)
SHORT_CODE=$(echo $RES2 | grep -o '"shortCode":"[^"]*' | cut -d'"' -f4)

echo "Created URL $URL_ID with short code $SHORT_CODE"

echo "Initial stats:"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/urls/$URL_ID/stats
echo ""

echo "Hitting short code twice..."
curl -s -I http://localhost:8080/$SHORT_CODE > /dev/null
curl -s -I http://localhost:8080/$SHORT_CODE > /dev/null

echo "Waiting for aggregator (15s)..."
sleep 15

echo "Updated stats:"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/urls/$URL_ID/stats
echo ""
