# ESXi Web Manager

A modern web interface for managing VMware ESXi virtual machines with a clean, responsive UI.

![ESXi Web Manager](screenshots/home.png)

## Features

- **VM Management**: Start, stop, reset, clone, delete, and **provision new VMs from a datastore ISO** (CPU/RAM/disk, firmware, hardware version, SCSI/NIC types, port groups, boot order, hot-add options)
- **Real-time Monitoring**: View VM status, specs, and IP addresses
- **VM Screenshots**: Capture and download console screenshots
- **Modern UI**: Clean, responsive interface with glass-morphism design
- **Docker-based**: Easy deployment with Docker Compose

## Requirements

- Docker and Docker Compose
- VMware ESXi host with API access enabled
- Network connectivity to the ESXi host

## Quick Start

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/esxi-web-manager.git
   cd esxi-web-manager
   ```

2. Configure your ESXi host and security-related environment variables (see `docker-compose.yml`). Copy [`.env.example`](.env.example) to `.env`, fill in secrets, and adjust defaults. At minimum set `ESXI_HOST`, `ESXI_USER`, `ESXI_PASSWORD`, and a strong `JWT_SECRET`. Change `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` before exposing the stack to a network.

   Docker Compose reads `.env` next to `docker-compose.yml`. Set `NEXT_PUBLIC_API_URL` to the API URL **as seen by the browser** (typically `http://127.0.0.1:8000` or your host LAN address with port `8000`); rebuild the frontend image after changing it.

3. (Optional) Set up SSH keys for enhanced VM cloning:
   ```bash
   mkdir -p keys
   ssh-keygen -t rsa -f ./keys/id_rsa -N ""
   ssh-copy-id -i ./keys/id_rsa.pub root@your.esxi.host.ip
   ```

4. Start the application:
   ```bash
   docker-compose up -d
   ```

5. Access the web interface at http://localhost:5656

## Architecture

- **Backend**: FastAPI application with SQLite-backed user accounts, JWT authentication, and pyVmomi access to ESXi
- **Frontend**: Next.js (App Router) UI that signs in against the API and sends `Authorization: Bearer` on VM operations

User passwords are stored using Argon2 hashes. The SQLite database lives in the `esxi_app_data` Docker volume (path `/app/data/app.db` inside the backend container).

## Security Considerations

- This application grants powerful control over your ESXi environment; restrict network access and rotate credentials regularly
- Set a long random `JWT_SECRET`, use strong admin credentials, and adjust `CORS_ORIGINS` to match the exact origins that will load the UI
- Optionally create additional users by running `python scripts/init_admin.py` inside the backend container with new `--username` / `--password` values (after the first deployment)

## Ports

- **5656**: Web interface (frontend)
- **8000**: API server (backend)

## Development

### Backend

The backend is a Python application using FastAPI and pyVmomi:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

The UI is a Next.js app under `web/`:

```bash
cd web
npm install
# Point the UI at your API (browser must reach this URL):
export NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
npm run dev
# Open http://localhost:3000
```

For local development, ensure the backend `CORS_ORIGINS` includes `http://localhost:3000` and `http://127.0.0.1:3000`.

## Troubleshooting

- Ensure ESXi host has API access enabled
- Check network connectivity between Docker and ESXi host
- Verify ESXi credentials in docker-compose.yml
- Check Docker container logs for errors:
  ```bash
  docker-compose logs
  ```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
