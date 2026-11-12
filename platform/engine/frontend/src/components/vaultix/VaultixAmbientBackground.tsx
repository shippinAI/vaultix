import { useEffect, useRef } from "react";

type FlowMode = "vertical" | "horizontal" | "mixed";
type AmbientMode = "idle" | "security" | "identity" | "vault" | "network";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  flow: FlowMode;
  drift: number;
};

export type VaultixAmbientBackgroundProps = {
  className?: string;
  mode?: AmbientMode;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const VaultixAmbientBackground = ({
  className = "",
  mode = "identity"
}: VaultixAmbientBackgroundProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const particles: Particle[] = Array.from({ length: 220 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      radius: Math.random() * 2.2 + 0.8,
      alpha: Math.random() * 0.8 + 0.2,
      flow: (Math.random() > 0.66 ? "vertical" : Math.random() > 0.5 ? "horizontal" : "mixed") as FlowMode,
      drift: Math.random() * 0.8 + 0.2
    }));

    let animationFrame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      width = rect.width || 1;
      height = rect.height || 1;
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const drawVaultEmblem = (time: number, morphStrength: number) => {
      const cx = width * 0.5;
      const cy = height * 0.5;
      const radius = Math.min(width, height) * (0.18 + morphStrength * 0.08);

      context.save();
      context.translate(cx, cy);
      context.beginPath();
      context.strokeStyle = `rgba(255, 196, 118, ${0.18 + morphStrength * 0.52})`;
      context.lineWidth = 1.4;
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 180) * (60 * i + 30);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.stroke();

      context.beginPath();
      context.strokeStyle = `rgba(123, 216, 120, ${0.18 + morphStrength * 0.52})`;
      context.lineWidth = 1.1;
      context.arc(0, 0, radius * 0.55, 0, Math.PI * 2);
      context.stroke();

      context.beginPath();
      context.moveTo(-radius * 0.18, 0);
      context.lineTo(radius * 0.18, 0);
      context.moveTo(0, -radius * 0.18);
      context.lineTo(0, radius * 0.18);
      context.stroke();

      context.restore();

      const pulse = 0.8 + Math.sin(time * 0.0017) * 0.2;
      const glow = context.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.5);
      glow.addColorStop(0, `rgba(123, 216, 120, ${0.12 * pulse})`);
      glow.addColorStop(0.35, `rgba(234, 144, 80, ${0.14 * pulse})`);
      glow.addColorStop(1, "rgba(20, 18, 16, 0)");
      context.fillStyle = glow;
      context.fillRect(cx - radius * 2.5, cy - radius * 2.5, radius * 5, radius * 5);
    };

    const animate = (time: number) => {
      if (!width || !height) return;

      context.clearRect(0, 0, width, height);

      const pointer = pointerRef.current;
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;

      const autoMorph = (Math.sin(time * 0.0007) + Math.sin(time * 0.0012 + 2.2)) * 0.5 + 0.5;
      const morphStrength = mode === "idle" ? clamp(autoMorph * 0.35, 0.1, 0.7) : mode === "security" ? 0.9 : mode === "vault" ? 0.8 : mode === "network" ? 0.7 : 0.65;
      const orange = mode === "idle" ? 160 : 206;
      const green = mode === "idle" ? 128 : 170;

      const background = context.createRadialGradient(
        width * pointer.x,
        height * pointer.y,
        0,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.8
      );
      background.addColorStop(0, `rgba(${orange}, ${122 + morphStrength * 30}, 70, 0.18)`);
      background.addColorStop(0.5, "rgba(25, 23, 18, 0.42)");
      background.addColorStop(1, "rgba(10, 10, 10, 0.9)");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const flowBias =
          particle.flow === "vertical"
            ? { x: 0.03, y: 0.09 }
            : particle.flow === "horizontal"
              ? { x: 0.09, y: 0.03 }
              : { x: 0.06, y: 0.06 };

        particle.x += particle.vx + flowBias.x * particle.drift + (pointer.x - particle.x) * 0.0007;
        particle.y += particle.vy + flowBias.y * particle.drift + (pointer.y - particle.y) * 0.0007;

        if (particle.x < 0 || particle.x > 1) particle.vx *= -1;
        if (particle.y < 0 || particle.y > 1) particle.vy *= -1;

        particle.x = clamp(particle.x, 0, 1);
        particle.y = clamp(particle.y, 0, 1);

        const px = particle.x * width;
        const py = particle.y * height;
        const pulse = 0.8 + Math.sin(time * 0.002 + index) * 0.45;
        const alpha = particle.alpha * (0.4 + morphStrength) * pulse;
        const rgb = index % 2 === 0 ? `rgba(240, 150, 92, ${alpha})` : `rgba(123, 216, 120, ${alpha})`;

        context.beginPath();
        context.fillStyle = rgb;
        context.arc(px, py, particle.radius + morphStrength * 0.7, 0, Math.PI * 2);
        context.fill();

        if (index % 4 === 0) {
          const dx = width * pointer.x - px;
          const dy = height * pointer.y - py;
          const distance = Math.hypot(dx, dy) || 1;
          if (distance < 120) {
            context.beginPath();
            context.strokeStyle = `rgba(123, 216, 120, ${Math.max(0.05, 0.18 - distance / 800)})`;
            context.lineWidth = 1;
            context.moveTo(px, py);
            context.lineTo(width * pointer.x, height * pointer.y);
            context.stroke();
          }
        }
      }

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        for (let next = index + 1; next < particles.length; next += 1) {
          const other = particles[next];
          const xDistance = (particle.x - other.x) * width;
          const yDistance = (particle.y - other.y) * height;
          const distance = Math.hypot(xDistance, yDistance);
          if (distance < 90) {
            context.beginPath();
            context.strokeStyle = `rgba(${orange}, ${green}, 118, ${0.12 * (1 - distance / 90)})`;
            context.lineWidth = 1;
            context.moveTo(particle.x * width, particle.y * height);
            context.lineTo(other.x * width, other.y * height);
            context.stroke();
          }
        }
      }

      if (mode !== "idle" || autoMorph > 0.75) {
        drawVaultEmblem(time, morphStrength);
      }

      animationFrame = window.requestAnimationFrame(animate);
    };

    resize();
    animationFrame = window.requestAnimationFrame(animate);
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerRef.current.tx = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
      pointerRef.current.ty = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    };
    const handlePointerLeave = () => {
      pointerRef.current.tx = 0.5;
      pointerRef.current.ty = 0.5;
    };

    window.addEventListener("resize", resize);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ pointerEvents: "none" }}
    />
  );
};

export default VaultixAmbientBackground;
