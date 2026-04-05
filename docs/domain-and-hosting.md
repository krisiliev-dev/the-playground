# Domain & Hosting Setup

## Domain: krisiliev.dev

### DNS Structure

| Record | Type  | Value                          | Purpose                    |
|--------|-------|--------------------------------|----------------------------|
| @      | A     | Vercel IP (76.76.21.21)        | Main site                  |
| www    | CNAME | cname.vercel-dns.com           | www redirect               |
| api    | A     | AWS ECS/ALB public IP          | WebSocket server           |
| demo   | CNAME | (Vercel preview domain)        | Demo environment           |

### URL Mapping

| URL                    | Points To           | Environment |
|------------------------|----------------------|-------------|
| krisiliev.dev          | Vercel (production)  | Production  |
| demo.krisiliev.dev     | Vercel (preview)     | Demo        |
| api.krisiliev.dev      | AWS ECS Fargate      | Production  |
| api-demo.krisiliev.dev | AWS ECS Fargate      | Demo        |

## Client Deployment (Vercel)

### Initial Setup

1. Install the Vercel CLI:
   ```bash
   pnpm add -g vercel
   ```

2. Link the project:
   ```bash
   cd client
   vercel link
   ```

3. Configure the project in Vercel dashboard:
   - Framework Preset: **Vite**
   - Root Directory: `client`
   - Build Command: `pnpm build`
   - Output Directory: `dist`

4. Add your domain in Vercel:
   - Go to Project Settings → Domains
   - Add `krisiliev.dev`
   - Vercel will tell you which DNS records to add at your registrar

5. Add GitHub secrets for CI/CD:
   - `VERCEL_TOKEN` — from vercel.com/account/tokens
   - `VERCEL_ORG_ID` — from `.vercel/project.json` after linking
   - `VERCEL_PROJECT_ID` — from `.vercel/project.json` after linking

### Environment Variables (Vercel Dashboard)

| Variable              | Production               | Demo                          |
|-----------------------|--------------------------|-------------------------------|
| VITE_WS_URL           | wss://api.krisiliev.dev  | wss://api-demo.krisiliev.dev  |
| VITE_ENVIRONMENT      | production               | demo                          |

## Server Deployment (AWS)

### Architecture

```
Internet → ALB (Application Load Balancer)
              ├── HTTPS termination (ACM certificate)
              └── → ECS Fargate Service
                      └── portfolio-world-server container
```

### Step-by-Step Setup

#### 1. Create an ECR Repository

```bash
aws ecr create-repository \
  --repository-name portfolio-world-server \
  --region eu-central-1
```

#### 2. Build and Push the Docker Image

```bash
cd server

# Login to ECR
aws ecr get-login-password --region eu-central-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com

# Build and push
docker build -t portfolio-world-server .
docker tag portfolio-world-server:latest <ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com/portfolio-world-server:latest
docker push <ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com/portfolio-world-server:latest
```

#### 3. Create ECS Cluster and Service

You can do this via the AWS Console (easier for first time) or with the AWS CLI / Terraform.

Key settings:
- **Launch type**: Fargate
- **CPU**: 256 (0.25 vCPU) — more than enough
- **Memory**: 512 MB — the Rust binary uses ~10MB
- **Port mapping**: 8080
- **Health check path**: `/health`

#### 4. Set Up Application Load Balancer

- Create an ALB in the same VPC as ECS
- Add HTTPS listener on port 443 (requires an ACM certificate for api.krisiliev.dev)
- Forward to ECS target group on port 8080
- Enable WebSocket stickiness on the target group

#### 5. Request ACM Certificate

```bash
aws acm request-certificate \
  --domain-name api.krisiliev.dev \
  --validation-method DNS \
  --region eu-central-1
```

Add the CNAME validation record at your domain registrar, then attach the certificate to the ALB.

#### 6. Add GitHub Secrets for CI/CD

| Secret                  | Value                                    |
|-------------------------|------------------------------------------|
| AWS_ACCESS_KEY_ID       | IAM user access key                      |
| AWS_SECRET_ACCESS_KEY   | IAM user secret key                      |
| AWS_REGION              | eu-central-1 (or your preferred region)  |
| AWS_ECR_REPOSITORY      | portfolio-world-server                   |
| AWS_ECS_CLUSTER_PROD    | portfolio-world-prod                     |
| AWS_ECS_SERVICE_PROD    | portfolio-world-server-prod              |
| AWS_ECS_CLUSTER_DEMO    | portfolio-world-demo                     |
| AWS_ECS_SERVICE_DEMO    | portfolio-world-server-demo              |

### Cost Estimate (AWS)

| Resource              | Monthly Cost   |
|-----------------------|----------------|
| Fargate (256 CPU/512 MB, always-on) | ~$9    |
| ALB                   | ~$16 + data    |
| ECR storage           | ~$1            |
| Data transfer          | ~$1-5          |
| **Total**             | **~$27-31/mo** |

#### Cheaper Alternative: EC2

If you want to minimise cost, skip Fargate + ALB and run on a single EC2 instance:

| Resource              | Monthly Cost   |
|-----------------------|----------------|
| t4g.nano (ARM, 2 vCPU, 0.5 GB) | ~$3   |
| Elastic IP            | Free (if attached) |
| **Total**             | **~$3/mo**     |

The trade-off is you manage the instance yourself (updates, restarts, SSL via Let's Encrypt instead of ACM). For a portfolio project, this is perfectly fine and saves ~$25/month.

## SSL/TLS

- **Vercel**: Automatic — HTTPS is enabled by default for custom domains.
- **AWS ALB**: Use ACM (free certificates, auto-renewing).
- **AWS EC2 (direct)**: Use Certbot with Let's Encrypt (free, auto-renewing with a cron job).
