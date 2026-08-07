# Cloud deployment

YT Zero needs one writable, persistent `/data` directory. It contains the
SQLite database, downloaded videos, avatars, image cache, logs, and other local
state. Run one instance when using SQLite. PostgreSQL can move the core database
off the local disk, but it does not replace `/data` for downloaded files and
other filesystem state.

## One-click deploy

[![Deploy to DigitalOcean](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/Pelski/ytzero/tree/main)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Pelski/ytzero)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/yt-zero-1?referralCode=1GJD2M&utm_medium=integration&utm_source=template&utm_campaign=generic)
[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=docker&image=ghcr.io%2Fpelski%2Fytzero%3Alatest&name=ytzero&service_type=web&instance_type=small&regions=fra&ports=3001%3Bhttp%3B%2F&env%5BPORT%5D=3001)
[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://www.heroku.com/deploy?template=https://github.com/Pelski/ytzero)

These buttons open the provider's deployment form and can create billable
resources. Review the selected region, instance, database, and disk before
confirming.

### Render

The repository's [`render.yaml`](https://github.com/Pelski/ytzero/blob/main/render.yaml)
builds the regular Dockerfile, exposes port `3001`, checks `/api/health`, and
provisions a 10 GB persistent disk at `/data`. The Blueprint deliberately has
automatic deploys disabled so forks do not unexpectedly follow this repository.

### DigitalOcean App Platform

The [`.do/deploy.template.yaml`](https://github.com/Pelski/ytzero/blob/main/.do/deploy.template.yaml)
template creates the web service and a development PostgreSQL database. App
Platform's application filesystem is ephemeral and it does not provide a
persistent `/data` mount. The database therefore survives deployments, but
downloaded videos, avatars, logs, caches, and other files do not. Use a
DigitalOcean Droplet, DigitalOcean Kubernetes, or another provider if those
files must persist.

### Koyeb

The button starts the published `ghcr.io/pelski/ytzero:latest` image on port
`3001`. After it is created, add a Koyeb Volume mounted at `/data` and redeploy
the service. Keep scaling at one instance while using SQLite. Availability,
regions, instance types, and pricing for volumes are controlled by Koyeb.

### Heroku

[`app.json`](https://github.com/Pelski/ytzero/blob/main/app.json) and
[`heroku.yml`](https://github.com/Pelski/ytzero/blob/main/heroku.yml) deploy the
container and provision the Essential-0 PostgreSQL add-on. Heroku's dyno
filesystem is ephemeral, so the template redirects all required local paths to
`/tmp`. Core application state survives in PostgreSQL, but downloads, avatars,
logs, caches, and other local files do not. The dyno and database are billable.

## Railway

Use the Railway button above to create the project from the published template,
or create a project directly from the public GitHub repository. Railway reads
[`railway.json`](https://github.com/Pelski/ytzero/blob/main/railway.json), which
uses `Dockerfile.railway`; that variant omits Docker's unsupported `VOLUME`
instruction without changing the normal Docker image.

Before the first start:

1. Add a Railway Volume to the YT Zero service.
2. Mount it at `/data`.
3. Generate a public domain for port `3001`.

The health check is already configured at `/api/health`. Confirm that the
template created the `/data` volume and public domain before relying on the
deployment for persistent data.

## Fly.io

The bundled [`deploy/fly/fly.toml`](https://github.com/Pelski/ytzero/blob/main/deploy/fly/fly.toml)
uses the published image, exposes the app through Fly Proxy, and declares a 10
GB `ytzero_data` volume in Frankfurt. Install and authenticate the Fly CLI,
then run from the repository:

```bash
fly launch --copy-config --no-deploy --config deploy/fly/fly.toml
fly deploy --config deploy/fly/fly.toml
```

Choose a globally unique app name when prompted. Keep one Machine because the
volume is local to its region and SQLite is not a multi-writer database. Change
`primary_region` before launching if `fra` is not appropriate.

## Kubernetes

The generic manifest includes a 10 GiB PersistentVolumeClaim, a single-replica
Deployment with health probes, and a ClusterIP Service:

```bash
kubectl apply -k deploy/kubernetes
kubectl port-forward service/ytzero 3001:80
```

Add an Ingress or change the Service type for public access. The cluster needs
a default StorageClass; otherwise add `storageClassName` to the claim. The
manifest uses `Recreate` and one replica to protect the default SQLite database.
It works as a starting point on DigitalOcean Kubernetes, GKE, EKS, AKS, k3s,
and other conforming clusters.

## Zeabur

The repository includes a publishable
[`deploy/zeabur/template.yaml`](https://github.com/Pelski/ytzero/blob/main/deploy/zeabur/template.yaml)
with the official image, HTTP port, public domain, and a persistent `/data`
volume. Import it with the Zeabur CLI or template tooling. Zeabur generates a
Deploy button only after the template owner publishes the template, so there is
no placeholder button in this documentation.

## Coolify, Portainer, Easypanel, TrueNAS, and other Docker hosts

Use the root
[`docker-compose.yml`](https://github.com/Pelski/ytzero/blob/main/docker-compose.yml)
as the Compose file, or create a service from
`ghcr.io/pelski/ytzero:latest` with:

- container port `3001` published through the platform;
- a persistent bind mount or named volume at `/data`;
- one replica;
- optional health check path `/api/health`.

In Coolify, select the public repository, choose the Docker Compose build pack,
and use `/docker-compose.yml` as the Compose location. Portainer can deploy the
same file as a Git-backed stack. CapRover and Dokku can use the same public image
when configured with persistent storage at `/data`.

## Dokku

Create the application and mount a named storage volume before pushing code:

```bash
dokku apps:create ytzero
dokku storage:create ytzero-data
dokku storage:mount ytzero ytzero-data --container-dir /data
git remote add dokku dokku@YOUR_HOST:ytzero
git push dokku main
```

Configure the hostname and TLS with the normal Dokku domains and Let's Encrypt
plugins. Do not scale the web process above one while it uses SQLite.

## Platforms without persistent container storage

Cloud Run, AWS App Runner, Azure Container Apps, Vercel, and similar
stateless runtimes are not a complete fit for YT Zero's default configuration.
They can run the web process with managed PostgreSQL, but local downloads,
avatars, logs, and caches remain ephemeral unless the platform also supplies a
compatible persistent filesystem. Prefer a VM, managed Kubernetes, or one of
the volume-capable options above.

## Backup before moving

Provider snapshots are not a portable backup. Use YT Zero's
[Backup & Updates](Backup-and-Updates) workflow and separately preserve any
downloaded media you need before moving or deleting a service.

## Provider documentation

- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Volumes](https://docs.railway.com/volumes), and [Templates](https://docs.railway.com/templates/publish-and-share)
- [DigitalOcean Deploy to DO button](https://docs.digitalocean.com/products/app-platform/how-to/add-deploy-do-button/) and [data storage](https://docs.digitalocean.com/products/app-platform/how-to/store-data/)
- [Render Deploy to Render button](https://render.com/docs/deploy-to-render) and [persistent disks](https://render.com/docs/disks)
- [Koyeb Deploy button](https://www.koyeb.com/docs/build-and-deploy/deploy-to-koyeb-button) and [volumes](https://www.koyeb.com/docs/reference/volumes)
- [Fly configuration](https://fly.io/docs/reference/configuration/) and [volume storage](https://fly.io/docs/launch/volume-storage/)
- [Coolify Docker Compose](https://coolify.io/docs/applications/build-packs/docker-compose) and [persistent storage](https://coolify.io/docs/knowledge-base/persistent-storage)
- [Dokku persistent storage](https://dokku.com/docs/advanced-usage/persistent-storage/)
- [Zeabur template format](https://zeabur.com/docs/en-US/template/template-format) and [Deploy buttons](https://zeabur.com/docs/en-US/deploy/methods/deploy-button)
- [Heroku Deploy buttons](https://devcenter.heroku.com/articles/heroku-button), [container runtime](https://devcenter.heroku.com/articles/container-registry-and-runtime), and [PostgreSQL plans](https://devcenter.heroku.com/articles/heroku-postgres-plans)
