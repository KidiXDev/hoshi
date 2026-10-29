import { invoke } from '@tauri-apps/api/core';

export interface GpuSpecs {
  name: string;
  vendor: string;
  dedicatedMemory: number;
  sharedMemory: number;
  driverVersion: string | null;
}

export interface DiskSpecs {
  name: string;
  mountPoint: string;
  fileSystem: string;
  kind: string;
  totalSpace: number;
  availableSpace: number;
  removable: boolean;
}

export interface SystemSpecs {
  osName: string;
  osVersion: string;
  kernelVersion: string;
  hostName: string;
  architecture: string;
  bootTime: number;
  cpuBrand: string;
  cpuVendor: string;
  physicalCores: number | null;
  logicalCores: number;
  totalMemory: number;
  totalSwap: number;
  gpus: GpuSpecs[];
  disks: DiskSpecs[];
}

export interface GpuUsage {
  name: string;
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
  temperature: number | null;
  powerDraw: number | null;
  powerLimit: number | null;
}

export interface SystemUsage {
  cpuUsage: number;
  coreUsage: number[];
  cpuFrequencyMhz: number;
  totalMemory: number;
  usedMemory: number;
  availableMemory: number;
  totalSwap: number;
  usedSwap: number;
  uptime: number;
  gpus: GpuUsage[];
}

export function getSystemSpecs() {
  return invoke<SystemSpecs>('get_system_specs');
}

export function getSystemUsage() {
  return invoke<SystemUsage>('get_system_usage');
}
