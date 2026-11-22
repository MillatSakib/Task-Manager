#!/bin/bash
set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    echo "Please run as root (e.g. sudo $0)"
    exit 1
fi

echo "=== Before Cleanup ==="
free -h

# Stop Docker & containerd only if running with zero active containers
# (check systemd state first so we do not socket-activate docker via `docker ps`)
if systemctl is-active --quiet docker.service; then
    running_containers="$(docker ps -q 2>/dev/null || true)"
    if [ -z "$running_containers" ]; then
        echo ""
        echo "Stopping idle docker.service and containerd.service..."
        systemctl stop docker.service containerd.service
    else
        echo ""
        echo "Skipping Docker stop: active containers are running."
    fi
elif systemctl is-active --quiet containerd.service; then
    echo ""
    echo "Stopping idle containerd.service..."
    systemctl stop containerd.service
fi

# Flush dirty buffers and drop reclaimable page, dentry, and inode caches
echo ""
echo "Dropping page, dentry, and inode caches..."
sync
echo 3 > /proc/sys/vm/drop_caches

echo ""
echo "=== After Cleanup ==="
free -h
