//! Real system telemetry for the session rail footer.
//!
//! The prototype faked these numbers with jitter; these are actual readings.
//! Sampled on demand from the frontend rather than pushed on a timer, so the
//! sampling rate stays a UI decision.

use parking_lot::Mutex;
use serde::Serialize;
use sysinfo::{Disks, Networks, System};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Telemetry {
    /// Whole-machine CPU load, 0–100.
    pub cpu: f32,
    /// Memory used, as a percentage of total.
    pub mem_percent: f32,
    /// Used and total memory in bytes — the rail shows `4.3/16G`.
    pub mem_used: u64,
    pub mem_total: u64,
    /// Bytes/sec since the previous sample.
    pub net_down: u64,
    pub net_up: u64,
    /// Per-core load, used to draw the sparkline.
    pub cores: Vec<f32>,
    /// Load average over 1, 5 and 15 minutes.
    pub load: [f64; 3],
    /// Space used and total on the volume holding the home directory.
    pub disk_used: u64,
    pub disk_total: u64,
}

pub struct TelemetrySampler {
    inner: Mutex<Inner>,
}

struct Inner {
    system: System,
    networks: Networks,
    disks: Disks,
    disks_at: std::time::Instant,
    last_rx: u64,
    last_tx: u64,
    last_at: std::time::Instant,
}

impl Inner {
    /// Disk usage barely moves between samples; re-stat every 30s, not every 2s.
    fn disks_stale(&self) -> bool {
        self.disks_at.elapsed() >= std::time::Duration::from_secs(30)
    }
}

impl TelemetrySampler {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_cpu_usage();
        system.refresh_memory();
        let networks = Networks::new_with_refreshed_list();
        let (rx, tx) = totals(&networks);
        Self {
            inner: Mutex::new(Inner {
                system,
                networks,
                disks: Disks::new_with_refreshed_list(),
                disks_at: std::time::Instant::now(),
                last_rx: rx,
                last_tx: tx,
                last_at: std::time::Instant::now(),
            }),
        }
    }

    pub fn sample(&self) -> Telemetry {
        let mut inner = self.inner.lock();

        inner.system.refresh_cpu_usage();
        inner.system.refresh_memory();
        inner.networks.refresh(true);

        let cores: Vec<f32> = inner
            .system
            .cpus()
            .iter()
            .map(|c| c.cpu_usage().clamp(0.0, 100.0))
            .collect();
        let cpu = if cores.is_empty() {
            0.0
        } else {
            cores.iter().sum::<f32>() / cores.len() as f32
        };

        let mem_total = inner.system.total_memory();
        let mem_used = inner.system.used_memory();
        let mem_percent = if mem_total == 0 {
            0.0
        } else {
            (mem_used as f32 / mem_total as f32) * 100.0
        };

        // Convert cumulative interface counters into a per-second rate.
        let (rx, tx) = totals(&inner.networks);
        let elapsed = inner.last_at.elapsed().as_secs_f64().max(0.001);
        let net_down = ((rx.saturating_sub(inner.last_rx)) as f64 / elapsed) as u64;
        let net_up = ((tx.saturating_sub(inner.last_tx)) as f64 / elapsed) as u64;
        inner.last_rx = rx;
        inner.last_tx = tx;
        inner.last_at = std::time::Instant::now();

        let avg = System::load_average();

        // Disks change far more slowly than CPU or network, so the list is
        // refreshed on a longer interval than the sample rate.
        if inner.disks_stale() {
            inner.disks.refresh(true);
            inner.disks_at = std::time::Instant::now();
        }
        let (disk_used, disk_total) = root_disk(&inner.disks);

        Telemetry {
            cpu,
            mem_percent,
            mem_used,
            mem_total,
            net_down,
            net_up,
            cores,
            load: [avg.one, avg.five, avg.fifteen],
            disk_used,
            disk_total,
        }
    }
}

/// Usage for the volume backing `$HOME`, falling back to the largest mount.
///
/// On macOS several synthetic volumes share the root device, so picking by
/// mount point rather than by index avoids reporting a read-only system snapshot.
fn root_disk(disks: &Disks) -> (u64, u64) {
    let home = std::env::var("HOME").unwrap_or_default();

    let mut best: Option<(usize, u64, u64)> = None;
    for disk in disks.list() {
        let mount = disk.mount_point().to_string_lossy().to_string();
        let total = disk.total_space();
        if total == 0 {
            continue;
        }
        let used = total.saturating_sub(disk.available_space());
        // Prefer the longest mount point that is a prefix of $HOME — that is the
        // volume the user's files actually live on.
        let score = if !home.is_empty() && home.starts_with(&mount) {
            mount.len()
        } else if mount == "/" {
            1
        } else {
            0
        };
        if score > 0 && best.map(|(s, _, _)| score > s).unwrap_or(true) {
            best = Some((score, used, total));
        }
    }

    best.map(|(_, used, total)| (used, total)).unwrap_or((0, 0))
}

impl Default for TelemetrySampler {
    fn default() -> Self {
        Self::new()
    }
}

fn totals(networks: &Networks) -> (u64, u64) {
    networks
        .iter()
        .fold((0u64, 0u64), |(rx, tx), (_, data)| {
            (
                rx.saturating_add(data.total_received()),
                tx.saturating_add(data.total_transmitted()),
            )
        })
}
