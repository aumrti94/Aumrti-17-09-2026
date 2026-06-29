import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Wifi, WifiOff, AlertTriangle, CheckCircle2, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

// CSSD Autoclave Anomaly Detector — IoT stub
// Real implementation requires MQTT broker connection + autoclave sensor hardware.
// This UI stub shows connection status and simulates cycle data for demo/testing.

interface CycleSample {
  timestamp: string;
  temperature: number;
  pressure: number;
  phase: string;
  anomaly: boolean;
  anomaly_reason?: string;
}

const WESTGARD_LIMITS = {
  sterilisation_temp_min: 134,
  sterilisation_temp_max: 138,
  pressure_min: 2.0,
  pressure_max: 3.5,
};

const AutoclaveMonitorPanel: React.FC = () => {
  const [mqttConnected] = useState(false); // No real MQTT in this environment
  const [simulating, setSimulating] = useState(false);
  const [cycleData, setCycleData] = useState<CycleSample[] | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const simulate = () => {
    setSimulating(true);
    // Generate 20 synthetic cycle data points with one anomaly
    const phases = ["pre_vacuum", "heating", "sterilisation", "sterilisation", "sterilisation", "sterilisation", "drying", "complete"];
    const samples: CycleSample[] = phases.flatMap((phase, i) => {
      const baseTemp = phase === "sterilisation" ? 136 : phase === "heating" ? 100 + i * 15 : phase === "drying" ? 90 : 25;
      const basePressure = phase === "sterilisation" ? 2.8 : phase === "pre_vacuum" ? 0.1 : phase === "heating" ? 1.5 : 1.0;

      // Introduce anomaly in sterilisation phase
      const isAnomaly = phase === "sterilisation" && i === 4;
      const temp = isAnomaly ? 131 : baseTemp + (Math.random() - 0.5) * 2;
      const pressure = isAnomaly ? 1.7 : basePressure + (Math.random() - 0.5) * 0.2;

      return {
        timestamp: new Date(Date.now() - (phases.length - i) * 180000).toLocaleTimeString(),
        temperature: parseFloat(temp.toFixed(1)),
        pressure: parseFloat(pressure.toFixed(2)),
        phase,
        anomaly: isAnomaly,
        anomaly_reason: isAnomaly ? "Temperature dropped below 134°C during sterilisation phase — Westgard 1-3s rule violated" : undefined,
      };
    });

    setTimeout(() => {
      setCycleData(samples);
      setSimulating(false);
    }, 1000);
  };

  const anomalies = cycleData?.filter(c => c.anomaly) ?? [];

  return (
    <div className="border rounded-lg overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-bold">Autoclave Anomaly Detector</span>
          <Badge variant="outline" className="text-[9px] px-1.5">IoT — CSSD</Badge>
          {mqttConnected ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px]">
              <Wifi className="h-3 w-3 mr-1" /> MQTT Live
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] border-muted-foreground text-muted-foreground">
              <WifiOff className="h-3 w-3 mr-1" /> Not Connected
            </Badge>
          )}
          {anomalies.length > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-300 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />{anomalies.length} anomaly detected
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setShowConfig(c => !c)}>
            <Settings className="h-3 w-3" /> Configure MQTT
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={simulate} disabled={simulating}>
            {simulating ? "Simulating..." : "Simulate Cycle"}
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* MQTT Configuration stub */}
        {showConfig && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-xs">
            <p className="text-sm font-semibold">MQTT Broker Configuration</p>
            <p className="text-muted-foreground">
              To enable real-time autoclave monitoring, connect an MQTT broker to your autoclave controller.
              The autoclave must publish temperature and pressure readings to the configured topic.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground block mb-1">MQTT Broker Host</label>
                <input className="w-full h-7 border rounded px-2 text-[11px] bg-background" placeholder="e.g. mqtt.hospital.local" disabled />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Port</label>
                <input className="w-full h-7 border rounded px-2 text-[11px] bg-background" placeholder="1883" disabled />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Topic</label>
                <input className="w-full h-7 border rounded px-2 text-[11px] bg-background" placeholder="cssd/autoclave/cycle" disabled />
              </div>
            </div>
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              ⚠️ MQTT IoT integration requires hardware setup. Contact your CSSD equipment vendor for autoclave sensor commissioning.
              This feature is pending IoT hardware procurement and MQTT broker deployment.
            </p>
          </div>
        )}

        {/* No data state */}
        {cycleData === null && !simulating && (
          <div className="text-center py-6 space-y-3">
            <WifiOff className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <div>
              <p className="text-sm text-muted-foreground">No live autoclave data</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                MQTT broker not connected. Click "Simulate Cycle" to preview monitoring with sample data.
              </p>
            </div>
            <div className="text-[10px] text-muted-foreground border rounded p-2 text-left max-w-xs mx-auto">
              <strong>Westgard thresholds configured:</strong><br />
              Sterilisation temp: {WESTGARD_LIMITS.sterilisation_temp_min}–{WESTGARD_LIMITS.sterilisation_temp_max}°C<br />
              Pressure: {WESTGARD_LIMITS.pressure_min}–{WESTGARD_LIMITS.pressure_max} bar
            </div>
          </div>
        )}

        {/* Simulation loading */}
        {simulating && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            Simulating autoclave cycle…
          </div>
        )}

        {/* Cycle data */}
        {cycleData && (
          <>
            {anomalies.length === 0 ? (
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Cycle completed within Westgard limits — no anomalies detected
              </div>
            ) : (
              <div className="space-y-1.5">
                {anomalies.map((a, i) => (
                  <div key={i} className="rounded border bg-red-50 border-red-200 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 mb-0.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                      <span className="font-semibold text-red-800">Anomaly at {a.timestamp} — {a.phase}</span>
                    </div>
                    <p className="text-[11px] text-red-700">{a.anomaly_reason}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Recorded: {a.temperature}°C / {a.pressure} bar
                    </p>
                  </div>
                ))}
                <p className="text-[11px] text-red-700 font-semibold">
                  ⚠️ This cycle may not meet sterilisation standards. Quarantine all instruments from this load pending re-sterilisation.
                </p>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border px-2 py-1 text-left">Time</th>
                    <th className="border px-2 py-1 text-left">Phase</th>
                    <th className="border px-2 py-1 text-right">Temp (°C)</th>
                    <th className="border px-2 py-1 text-right">Pressure (bar)</th>
                    <th className="border px-2 py-1 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cycleData.map((s, i) => (
                    <tr key={i} className={cn(s.anomaly ? "bg-red-50" : i % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                      <td className="border px-2 py-0.5">{s.timestamp}</td>
                      <td className="border px-2 py-0.5 capitalize">{s.phase.replace(/_/g, " ")}</td>
                      <td className={cn("border px-2 py-0.5 text-right font-mono", s.anomaly ? "text-red-700 font-bold" : "")}>{s.temperature}</td>
                      <td className={cn("border px-2 py-0.5 text-right font-mono", s.anomaly ? "text-red-700 font-bold" : "")}>{s.pressure}</td>
                      <td className="border px-2 py-0.5 text-center">
                        {s.anomaly
                          ? <span className="text-red-600 font-bold">⚠ ANOMALY</span>
                          : <span className="text-emerald-600">✓</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-muted-foreground italic">
              Simulated data for demonstration. Real-time monitoring requires MQTT hardware integration.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default AutoclaveMonitorPanel;
