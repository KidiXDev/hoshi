use serde::Serialize;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System};
use tauri::State;

const MIB: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSpecs {
    os_name: String,
    os_version: String,
    kernel_version: String,
    host_name: String,
    architecture: String,
    boot_time: u64,
    cpu_brand: String,
    cpu_vendor: String,
    physical_cores: Option<usize>,
    logical_cores: usize,
    total_memory: u64,
    total_swap: u64,
    gpus: Vec<GpuSpecs>,
    disks: Vec<DiskSpecs>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSpecs {
    name: String,
    vendor: String,
    dedicated_memory: u64,
    shared_memory: u64,
    driver_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpecs {
    name: String,
    mount_point: String,
    file_system: String,
    kind: String,
    total_space: u64,
    available_space: u64,
    removable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemUsage {
    cpu_usage: f32,
    core_usage: Vec<f32>,
    cpu_frequency_mhz: u64,
    total_memory: u64,
    used_memory: u64,
    available_memory: u64,
    total_swap: u64,
    used_swap: u64,
    uptime: u64,
    gpus: Vec<GpuUsage>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuUsage {
    name: String,
    utilization: f32,
    memory_used: u64,
    memory_total: u64,
    temperature: Option<f32>,
    power_draw: Option<f32>,
    power_limit: Option<f32>,
}

#[derive(Clone)]
pub struct SystemMonitor {
    system: Arc<Mutex<System>>,
    nvidia_smi_available: Arc<AtomicBool>,
}

impl Default for SystemMonitor {
    fn default() -> Self {
        Self {
            system: Arc::new(Mutex::new(System::new_with_specifics(usage_refresh_kind()))),
            nvidia_smi_available: Arc::new(AtomicBool::new(true)),
        }
    }
}

fn usage_refresh_kind() -> RefreshKind {
    RefreshKind::nothing()
        .with_cpu(CpuRefreshKind::nothing().with_cpu_usage().with_frequency())
        .with_memory(MemoryRefreshKind::everything())
}

impl SystemMonitor {
    fn usage(&self) -> Result<SystemUsage, String> {
        let gpus = self.nvidia_usage();
        let mut system = self
            .system
            .lock()
            .map_err(|_| "System monitor lock is unavailable")?;
        system.refresh_specifics(usage_refresh_kind());
        let cpus = system.cpus();
        Ok(SystemUsage {
            cpu_usage: system.global_cpu_usage(),
            core_usage: cpus.iter().map(|cpu| cpu.cpu_usage()).collect(),
            cpu_frequency_mhz: cpus.iter().map(|cpu| cpu.frequency()).max().unwrap_or(0),
            total_memory: system.total_memory(),
            used_memory: system.used_memory(),
            available_memory: system.available_memory(),
            total_swap: system.total_swap(),
            used_swap: system.used_swap(),
            uptime: System::uptime(),
            gpus,
        })
    }

    fn nvidia_usage(&self) -> Vec<GpuUsage> {
        if !self.nvidia_smi_available.load(Ordering::Relaxed) {
            return Vec::new();
        }
        let mut command = Command::new("nvidia-smi");
        command.args([
            "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit",
            "--format=csv,noheader,nounits",
        ]);
        crate::process_manager::hide_command_window(&mut command);
        match command.output() {
            Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(parse_nvidia_smi_line)
                .collect(),
            Ok(_) => Vec::new(),
            Err(_) => {
                self.nvidia_smi_available.store(false, Ordering::Relaxed);
                Vec::new()
            }
        }
    }
}

fn parse_nvidia_smi_line(line: &str) -> Option<GpuUsage> {
    let fields: Vec<&str> = line.split(',').map(str::trim).collect();
    let [name, utilization, used, total, temperature, power_draw, power_limit] = fields.as_slice()
    else {
        return None;
    };
    let number = |value: &str| value.parse::<f32>().ok();
    Some(GpuUsage {
        name: (*name).to_string(),
        utilization: number(utilization)?,
        memory_used: number(used)? as u64 * MIB,
        memory_total: number(total)? as u64 * MIB,
        temperature: number(temperature),
        power_draw: number(power_draw),
        power_limit: number(power_limit),
    })
}

fn system_specs() -> SystemSpecs {
    let system = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing())
            .with_memory(MemoryRefreshKind::everything()),
    );
    let first_cpu = system.cpus().first();
    SystemSpecs {
        os_name: System::long_os_version()
            .or_else(System::name)
            .unwrap_or_default(),
        os_version: System::os_version().unwrap_or_default(),
        kernel_version: System::kernel_long_version(),
        host_name: System::host_name().unwrap_or_default(),
        architecture: System::cpu_arch(),
        boot_time: System::boot_time(),
        cpu_brand: first_cpu
            .map(|cpu| cpu.brand().trim().to_string())
            .unwrap_or_default(),
        cpu_vendor: first_cpu
            .map(|cpu| cpu.vendor_id().to_string())
            .unwrap_or_default(),
        physical_cores: System::physical_core_count(),
        logical_cores: system.cpus().len(),
        total_memory: system.total_memory(),
        total_swap: system.total_swap(),
        gpus: list_gpus(),
        disks: Disks::new_with_refreshed_list()
            .list()
            .iter()
            .map(|disk| DiskSpecs {
                name: disk.name().to_string_lossy().into_owned(),
                mount_point: disk.mount_point().to_string_lossy().into_owned(),
                file_system: disk.file_system().to_string_lossy().into_owned(),
                kind: disk.kind().to_string(),
                total_space: disk.total_space(),
                available_space: disk.available_space(),
                removable: disk.is_removable(),
            })
            .collect(),
    }
}

fn gpu_vendor(vendor_id: u32) -> &'static str {
    match vendor_id {
        0x10DE => "NVIDIA",
        0x1002 | 0x1022 => "AMD",
        0x8086 => "Intel",
        0x1414 => "Microsoft",
        0x5143 => "Qualcomm",
        _ => "Unknown",
    }
}

fn driver_version_from_umd(version: i64) -> String {
    let parts = [48, 32, 16, 0].map(|shift| (version >> shift) & 0xFFFF);
    format!("{}.{}.{}.{}", parts[0], parts[1], parts[2], parts[3])
}

#[cfg(windows)]
fn list_gpus() -> Vec<GpuSpecs> {
    use windows::core::Interface;
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIDevice, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
    };

    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return Vec::new();
    };
    let mut gpus = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for index in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0
            || (desc.DedicatedVideoMemory == 0 && desc.SharedSystemMemory == 0)
            || !seen.insert((desc.VendorId, desc.DeviceId, desc.SubSysId, desc.Revision))
        {
            continue;
        }
        let name_length = desc
            .Description
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(desc.Description.len());
        gpus.push(GpuSpecs {
            name: String::from_utf16_lossy(&desc.Description[..name_length]),
            vendor: gpu_vendor(desc.VendorId).to_string(),
            dedicated_memory: desc.DedicatedVideoMemory as u64,
            shared_memory: desc.SharedSystemMemory as u64,
            driver_version: unsafe { adapter.CheckInterfaceSupport(&IDXGIDevice::IID) }
                .ok()
                .map(driver_version_from_umd),
        });
    }
    gpus
}

#[cfg(not(windows))]
fn list_gpus() -> Vec<GpuSpecs> {
    Vec::new()
}

#[tauri::command]
pub async fn get_system_specs() -> Result<SystemSpecs, String> {
    tauri::async_runtime::spawn_blocking(system_specs)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_system_usage(monitor: State<'_, SystemMonitor>) -> Result<SystemUsage, String> {
    let monitor = monitor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || monitor.usage())
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nvidia_smi_rows() {
        assert_eq!(
            parse_nvidia_smi_line(
                "NVIDIA GeForce RTX 4050 Laptop GPU, 15, 990, 6141, 47, 4.26, [N/A]"
            ),
            Some(GpuUsage {
                name: "NVIDIA GeForce RTX 4050 Laptop GPU".into(),
                utilization: 15.0,
                memory_used: 990 * MIB,
                memory_total: 6141 * MIB,
                temperature: Some(47.0),
                power_draw: Some(4.26),
                power_limit: None,
            })
        );
        assert_eq!(parse_nvidia_smi_line("GPU, [N/A], 1, 2, 3, 4, 5"), None);
        assert_eq!(parse_nvidia_smi_line("too, few"), None);
    }

    #[test]
    fn decodes_umd_driver_version() {
        let version = (32_i64 << 48) | (15 << 16) | 9636;
        assert_eq!(driver_version_from_umd(version), "32.0.15.9636");
    }

    #[test]
    #[ignore]
    fn prints_this_machine() {
        let monitor = SystemMonitor::default();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        println!(
            "{}\n{}",
            serde_json::to_string_pretty(&system_specs()).unwrap(),
            serde_json::to_string_pretty(&monitor.usage().unwrap()).unwrap()
        );
    }
}
