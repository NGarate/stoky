# Infrastructure Solutions for Stoky Development

This document provides multiple solutions for the Docker permission issue and local development setup.

## Problem

When running `docker compose up -d db cache`, you encounter:

```
permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock
```

This means your user doesn't have permission to access the Docker daemon.

---

## Option 1: Fix Docker Permissions (Recommended)

Add your user to the `docker` group to run Docker commands without `sudo`.

### Steps:

1. **Add your user to the docker group:**
   ```bash
   sudo usermod -aG docker $USER
   ```

2. **Apply the new group membership:**
   ```bash
   # Log out and log back in, OR:
   newgrp docker
   ```

3. **Verify Docker works:**
   ```bash
   docker run hello-world
   ```

4. **Start the Stoky services:**
   ```bash
   docker compose up -d db cache
   ```

### Pros:
- Cleanest solution
- No sudo required for future Docker commands
- Works with all Docker tooling

### Cons:
- Requires logout/login or newgrp
- Slight security consideration (user can run Docker without sudo)

---

## Option 2: Use sudo with Docker Commands

Run Docker commands with elevated privileges.

### Steps:

1. **Start services with sudo:**
   ```bash
   sudo docker compose up -d db cache
   ```

2. **Create an alias (optional):**
   Add to your `~/.bashrc` or `~/.zshrc`:
   ```bash
   alias docker='sudo docker'
   alias docker-compose='sudo docker-compose'
   ```

### Pros:
- Immediate fix, no configuration changes
- Works right away

### Cons:
- Requires sudo every time
- Environment variables may not be available under sudo
- More typing required

### Troubleshooting sudo environment:

If you get "DATABASE_URL not set" errors:

```bash
# Option A: Use sudo -E to preserve environment
sudo -E docker compose up -d db cache

# Option B: Copy .env to /root/
sudo cp .env /root/
sudo docker compose up -d db cache
```

---

## Option 3: Local Development Without Docker

Run PostgreSQL and Valkey directly on your host machine. This is ideal if you prefer not to use Docker or have permission issues.

### Prerequisites:

- PostgreSQL 16+
- Redis or Valkey (optional, for caching)
- pnpm

### Quick Start:

1. **Run the setup script:**
   ```bash
   chmod +x scripts/dev-local.sh
   ./scripts/dev-local.sh
   ```

2. **The script will:**
   - Check for required tools (pnpm, psql, redis-cli)
   - Verify PostgreSQL is running
   - Create the database and user if needed
   - Set up your `.env` file
   - Provide next steps

3. **Complete setup:**
   ```bash
   pnpm install
   pnpm prisma migrate dev
   pnpm prisma db seed  # optional
   pnpm dev
   ```

### Manual Setup (if script fails):

#### Install PostgreSQL:

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

**macOS:**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Arch Linux:**
```bash
sudo pacman -S postgresql
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### Create Database and User:

```bash
sudo -u postgres psql -c "CREATE DATABASE stoky;"
sudo -u postgres psql -c "CREATE USER stoky WITH PASSWORD 'stoky_dev_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE stoky TO stoky;"
```

#### Install Redis (Optional):

**Ubuntu/Debian:**
```bash
sudo apt-get install redis-server
sudo systemctl start redis
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Arch Linux:**
```bash
sudo pacman -S redis
sudo systemctl start redis
```

### Environment Variables:

The `.env` file should already have the correct values for local development:

```env
DATABASE_URL="postgresql://stoky:stoky_dev_password@localhost:5432/stoky?schema=public"
VALKEY_URL="redis://localhost:6379"
```

### Pros:
- No Docker required
- Direct database access for debugging
- IDEs can connect directly to PostgreSQL
- Potentially faster for development

### Cons:
- Need to manage PostgreSQL/Redis versions manually
- Slightly different from production environment
- Database persists between runs (may need cleanup)

---

## Option 4: Rootless Docker (Advanced)

Run Docker in rootless mode for improved security.

### Installation:

```bash
# Install rootless Docker
dockerd-rootless-setuptool.sh install

# Or use Docker Desktop which runs rootless by default
```

### Configuration:

```bash
# Add to ~/.bashrc or ~/.zshrc
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock
```

### Pros:
- Most secure option
- No sudo or docker group needed
- Follows principle of least privilege

### Cons:
- More complex setup
- Some features may not work (e.g., privileged containers)
- Requires recent Docker version

---

## Verification

After setting up with any option, verify everything works:

```bash
# Check database connection
pnpm prisma db pull

# Run tests
bun test

# Start development server
pnpm dev
```

Visit http://localhost:3000 to see the app.

---

## Switching Between Options

You can switch between Docker and local development:

**From Docker to Local:**
```bash
# Stop Docker services
docker compose down

# Start local PostgreSQL
sudo systemctl start postgresql

# Run setup
./scripts/dev-local.sh
```

**From Local to Docker:**
```bash
# Stop local PostgreSQL (optional)
sudo systemctl stop postgresql

# Start Docker services
docker compose up -d db cache

# Update .env if needed (DATABASE_URL uses 'db' instead of 'localhost')
```

**Note:** When using Docker, the `.env` DATABASE_URL uses `localhost` because Docker port forwards. The internal Docker network uses service names (`db`, `cache`) but those are only accessible from within containers.

---

## Troubleshooting

### "docker: command not found"

Docker is not installed. Install it:
- Ubuntu: `sudo apt-get install docker.io docker-compose`
- macOS: Install Docker Desktop from https://docs.docker.com/desktop/mac/install/
- Arch: `sudo pacman -S docker docker-compose`

### "Cannot connect to the Docker daemon"

Docker service is not running:
```bash
sudo systemctl start docker
sudo systemctl enable docker  # auto-start on boot
```

### "port is already allocated" (Docker)

Another service is using port 3000:
```bash
# Find the process
lsof -i :3000

# Kill it or change the port in docker-compose.yml
```

### "database "stoky" does not exist" (Local)

Run the database creation commands from Option 3.

### Migration fails

```bash
# Reset and re-run migrations
pnpm prisma migrate reset
pnpm prisma migrate dev
```

---

## Recommended Workflow

For most developers, we recommend:

1. **First time:** Try Option 1 (Fix permissions) - it's the most common solution
2. **If that fails:** Use Option 2 (sudo) temporarily
3. **For debugging/DB work:** Consider Option 3 (Local) for easier database access
4. **For security-conscious:** Use Option 4 (Rootless Docker)

All options work equally well for development. Choose what fits your workflow and system setup.

---

## Getting Help

If you encounter issues not covered here:

1. Check the Docker logs: `docker compose logs`
2. Check PostgreSQL logs: `sudo journalctl -u postgresql`
3. Verify your `.env` file matches your setup
4. Ask in the project chat/forum
