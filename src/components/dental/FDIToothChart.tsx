import React from "react";
import { ToothSVG, type Surface, type ToothStatus } from "./ToothSVG";

export type ChartData = Record<
  number,
  {
    surfaces: Partial<Record<Surface, ToothStatus>>;
    overallStatus?: ToothStatus;
  }
>;

interface FDIToothChartProps {
  chartData: ChartData;
  onSurfaceClick: (tooth: number, surface: Surface) => void;
}

const UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
const UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41];
const LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38];

// Primary teeth (Deciduous)
const UPPER_PRIMARY_RIGHT = [55, 54, 53, 52, 51];
const UPPER_PRIMARY_LEFT = [61, 62, 63, 64, 65];
const LOWER_PRIMARY_RIGHT = [85, 84, 83, 82, 81];
const LOWER_PRIMARY_LEFT = [71, 72, 73, 74, 75];

const FDIToothChart: React.FC<FDIToothChartProps> = ({ chartData, onSurfaceClick }) => {
  const renderRow = (teeth: number[]) => (
    <div className="flex gap-1.5">
      {teeth.map((t) => (
        <ToothSVG
          key={t}
          toothNumber={t}
          surfaces={chartData[t]?.surfaces || {}}
          overallStatus={chartData[t]?.overallStatus}
          onClick={(surface) => onSurfaceClick(t, surface)}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6 items-center w-full py-2 overflow-x-auto min-w-max">
      <div className="text-center font-semibold text-[14px] text-muted-foreground uppercase tracking-widest border-b pb-2 w-full">
        Adult Teeth (Permanent)
      </div>

      <div className="flex flex-col gap-4 items-center bg-muted/10 p-4 rounded-xl border border-border">
        {/* Upper Jaw */}
        <div className="flex gap-6 border-b-2 border-border pb-4">
          <div className="flex flex-col items-end">
            <span className="text-[14px] text-muted-foreground mb-2 font-medium">Upper Right (1)</span>
            {renderRow(UPPER_RIGHT)}
          </div>
          <div className="w-0.5 bg-border rounded-full" />
          <div className="flex flex-col items-start">
            <span className="text-[14px] text-muted-foreground mb-2 font-medium">Upper Left (2)</span>
            {renderRow(UPPER_LEFT)}
          </div>
        </div>

        {/* Lower Jaw */}
        <div className="flex gap-6 pt-2">
          <div className="flex flex-col items-end">
            {renderRow(LOWER_RIGHT)}
            <span className="text-[14px] text-muted-foreground mt-2 font-medium">Lower Right (4)</span>
          </div>
          <div className="w-0.5 bg-border rounded-full" />
          <div className="flex flex-col items-start">
            {renderRow(LOWER_LEFT)}
            <span className="text-[14px] text-muted-foreground mt-2 font-medium">Lower Left (3)</span>
          </div>
        </div>
      </div>

      <div className="text-center font-semibold text-[14px] text-muted-foreground uppercase tracking-widest border-b pb-2 w-full mt-4">
        Primary Teeth (Deciduous)
      </div>

      <div className="flex flex-col gap-4 items-center opacity-90 p-4 rounded-xl border border-dashed border-border">
        <div className="flex gap-6 border-b-2 border-border pb-4">
          <div className="flex flex-col items-end">{renderRow(UPPER_PRIMARY_RIGHT)}</div>
          <div className="w-0.5 bg-border rounded-full" />
          <div className="flex flex-col items-start">{renderRow(UPPER_PRIMARY_LEFT)}</div>
        </div>
        <div className="flex gap-6 pt-2">
          <div className="flex flex-col items-end">{renderRow(LOWER_PRIMARY_RIGHT)}</div>
          <div className="w-0.5 bg-border rounded-full" />
          <div className="flex flex-col items-start">{renderRow(LOWER_PRIMARY_LEFT)}</div>
        </div>
      </div>
    </div>
  );
};

export default FDIToothChart;