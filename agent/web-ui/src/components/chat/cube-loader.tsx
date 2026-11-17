import './cube-loader.css';

const faces = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const;

type CubeLoaderProps = { className?: string };

/* A small isometric cube that tumbles a quarter turn and settles, decorative only. */
export function CubeLoader({ className }: CubeLoaderProps) {
  return (
    <span aria-hidden="true" className={className ? `cube-loader ${className}` : 'cube-loader'}>
      <span className="cube-loader-body">
        {faces.map((face) => (
          <span key={face} className="cube-loader-face" data-face={face} />
        ))}
      </span>
    </span>
  );
}
