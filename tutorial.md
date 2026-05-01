# Project Setup & Execution Guide

This guide will help you get the **Shortly — Link Management** project up and running on your local machine.

## Prerequisites

Before starting, ensure you have the following installed:
- **Java 21 LTS**
- **Node.js** (v18 or higher) & **npm**
- **PostgreSQL 16**
- **Redis**
- **Docker** (Optional, for containerized execution)

---

## Method 1: Running Locally (Recommended for Development)

### 1. Database Setup
Ensure PostgreSQL is running and create the database and user as specified in `application.yml`:

```sql
-- Connect to psql and run:
CREATE DATABASE shortly;
CREATE USER shortly WITH PASSWORD 'shortly';
GRANT ALL PRIVILEGES ON DATABASE shortly TO shortly;
```

### 2. Redis Setup
Ensure Redis is running on the default port `6379`.

### 3. Run the Backend (Spring Boot)
Open a terminal in the `backend` directory:

```bash
cd backend
# Using the bundled Maven wrapper or your local Maven installation
../apache-maven-3.9.9/bin/mvn spring-boot:run
```
The backend will be available at `http://localhost:8080`. You can verify it's running by visiting `http://localhost:8080/actuator/health`.

### 4. Run the Frontend (React + Vite)
Open a new terminal in the `frontend` directory:

```bash
cd frontend
npm install  # If running for the first time
npm run dev
```
The frontend will be available at `http://localhost:5173`.

---

## Method 2: Running with Docker (One-Command Setup)

If you have Docker and Docker Compose installed, you can start everything (Postgres, Redis, Backend, Frontend) with a single command from the root directory:

```bash
docker-compose up --build
```

- **Frontend**: `http://localhost:3000` (mapped in Docker)
- **Backend API**: `http://localhost:8080`
- **Postgres**: `localhost:5432`
- **Redis**: `localhost:6379`

---

## Troubleshooting

### Port Conflicts
- **8080**: If the backend fails to start, check if another process is using port 8080:
  ```bash
  lsof -i :8080
  kill -9 <PID>
  ```
- **5173/5174**: If the frontend port is taken, Vite will automatically pick the next one. Ensure the `APP_FRONTEND_URL` in backend `application.yml` matches.

### Common Errors
- **DB Connection Failed**: Ensure the `shortly` database exists and the credentials match.
- **Redis Connection Failed**: Ensure the Redis service is active (`brew services start redis` on Mac).

---

## Testing the Flow
Once everything is running:
1. Open `http://localhost:5173` in your browser.
2. Click **Create Account** and register.
3. Paste a long URL in the input box and click **Shorten**.
4. Click the generated short link to verify the redirect.
5. Check your dashboard to see the click analytics update!
