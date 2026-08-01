//! Real system telemetry for the session rail footer.
//!
//! The prototype faked these numbers with jitter; these are actual readings.
//! Sampled on demand from the frontend rather than pushed on a timer, so the
//! sampling rate stays a UI decision.

use parking_lot::Mutex;
use serde::Serialize;
use sysinfo::{Networks, System};

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
}

pub struct TelemetrySampler {
    inner: Mutex<Inner>,
}

struct Inner {
    system: System,
    networks: Networks,
    last_rx: u64,
    last_tx: u64,
    last_at: std::time::Instant,
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

        Telemetry {
            cpu,
            mem_percent,
            mem_used,
            mem_total,
            net_down,
            net_up,
            cores,
        }
    }
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
