import { useRef, useEffect } from 'react';

interface WaveformVisualizerProps {
  frequencyData: Readonly<number[]>;
  isActive: boolean;
  isSilent: boolean;
}

export function WaveformVisualizer({ frequencyData, isActive, isSilent }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    if (!isActive) {
      // Flat idle line
      ctx.strokeStyle = 'rgba(99, 153, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const numBars = frequencyData.length;
    const gap = 3;
    const barWidth = w / numBars - gap / numBars;

    frequencyData.forEach((value, i) => {
      const barH = Math.max(3, value * h * 0.85);
      const x = i * (w / numBars) + gap / 2;
      const y = (h - barH) / 2;

      const alpha = isSilent ? 0.25 : Math.max(0.15, value * 1.2);
      const r = isSilent ? 100 : 99;
      const g = isSilent ? 120 : 153;
      const b = isSilent ? 160 : 255;

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fillRect(x, y, barWidth, barH);
    });
  }, [frequencyData, isActive, isSilent]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
}
