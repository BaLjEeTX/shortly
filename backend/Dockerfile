# backend/Dockerfile
# Multi-arch base images (amd64 + arm64) — the -alpine tags don't publish
# arm64, which breaks builds on Apple Silicon Macs.

FROM maven:3.9.9-eclipse-temurin-17 AS deps
WORKDIR /app
COPY pom.xml .
RUN mvn -B dependency:go-offline

FROM deps AS build
COPY src ./src
RUN mvn -B clean package -DskipTests

FROM eclipse-temurin:17-jre AS runtime
RUN groupadd -r spring && useradd -r -g spring spring
WORKDIR /app
COPY --from=build --chown=spring:spring /app/target/*.jar app.jar
USER spring:spring
EXPOSE 8080
ENV JAVA_OPTS="-XX:+UseG1GC -XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
