// Health Service for WiFi-DensePose UI

import { API_CONFIG } from '../config/api.config.js';
import { apiService } from './api.service.js';

export class HealthService {
  constructor() {
    this.healthCheckInterval = null;
    this.healthSubscribers = [];
    this.lastHealthStatus = null;
  }

  // Get system health
  async getSystemHealth() {
    const [health, metrics] = await Promise.all([
      apiService.get(API_CONFIG.ENDPOINTS.HEALTH.SYSTEM),
      apiService.get(API_CONFIG.ENDPOINTS.HEALTH.METRICS).catch(() => null)
    ]);

    const source = health?.source || 'unknown';
    const isHealthy = health?.status === 'ok' || health?.status === 'ready' || health?.status === 'healthy';
    const sourceText = typeof source === 'string' ? source : 'unknown';
    const liveHardware = sourceText.startsWith('wifi') || sourceText === 'esp32' || sourceText === 'live';
    const simulated = sourceText.includes('simulated') || sourceText.includes('simulate');

    const normalized = {
      ...health,
      status: isHealthy ? 'healthy' : 'error',
      components: {
        hardware: {
          status: liveHardware ? 'healthy' : (simulated ? 'warning' : 'degraded'),
          message: `Source: ${sourceText}`
        },
        stream: {
          status: isHealthy ? 'healthy' : 'degraded',
          message: `Tick ${health?.tick ?? '-'}`
        },
        pose: {
          status: liveHardware ? 'healthy' : 'warning',
          message: liveHardware ? 'RSSI/WiFi sensing active' : 'No live hardware inference'
        }
      },
      metrics
    };

    this.lastHealthStatus = normalized;
    this.notifySubscribers(normalized);
    return normalized;
  }

  // Check readiness
  async checkReadiness() {
    return apiService.get(API_CONFIG.ENDPOINTS.HEALTH.READY);
  }

  // Check liveness
  async checkLiveness() {
    return apiService.get(API_CONFIG.ENDPOINTS.HEALTH.LIVE);
  }

  // Get system metrics
  async getSystemMetrics() {
    return apiService.get(API_CONFIG.ENDPOINTS.HEALTH.METRICS);
  }

  // Get version info
  async getVersion() {
    return apiService.get(API_CONFIG.ENDPOINTS.HEALTH.VERSION);
  }

  // Get API info
  async getApiInfo() {
    return apiService.get(API_CONFIG.ENDPOINTS.INFO);
  }

  // Get API status
  async getApiStatus() {
    return apiService.get(API_CONFIG.ENDPOINTS.STATUS);
  }

  // Start periodic health checks
  startHealthMonitoring(intervalMs = 30000) {
    if (this.healthCheckInterval) {
      console.warn('Health monitoring already active');
      return;
    }

    // Initial check (silent on failure — DensePose API may not be running)
    this.getSystemHealth().catch(() => {
      // DensePose API not running — sensing-only mode, skip polling
      this._backendUnavailable = true;
    });

    // Set up periodic checks only if backend was reachable
    this.healthCheckInterval = setInterval(() => {
      if (this._backendUnavailable) return;
      this.getSystemHealth().catch(error => {
        this.notifySubscribers({
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      });
    }, intervalMs);
  }

  // Stop health monitoring
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // Subscribe to health updates
  subscribeToHealth(callback) {
    this.healthSubscribers.push(callback);
    
    // Send last known status if available
    if (this.lastHealthStatus) {
      callback(this.lastHealthStatus);
    }
    
    // Return unsubscribe function
    return () => {
      const index = this.healthSubscribers.indexOf(callback);
      if (index > -1) {
        this.healthSubscribers.splice(index, 1);
      }
    };
  }

  // Notify subscribers
  notifySubscribers(health) {
    this.healthSubscribers.forEach(callback => {
      try {
        callback(health);
      } catch (error) {
        console.error('Error in health subscriber:', error);
      }
    });
  }

  // Check if system is healthy
  isSystemHealthy() {
    if (!this.lastHealthStatus) {
      return null;
    }
    return this.lastHealthStatus.status === 'healthy';
  }

  // Get component status
  getComponentStatus(componentName) {
    if (!this.lastHealthStatus?.components) {
      return null;
    }
    return this.lastHealthStatus.components[componentName];
  }

  // Clean up
  dispose() {
    this.stopHealthMonitoring();
    this.healthSubscribers = [];
    this.lastHealthStatus = null;
  }
}

// Create singleton instance
export const healthService = new HealthService();
