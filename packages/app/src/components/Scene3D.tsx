import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sphere } from '@react-three/drei';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { useFrame } from '@react-three/fiber';

function AudioSphere() {
  const meshRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.4;
      meshRef.current.rotation.x += delta * 0.15;
    }
  });

  return (
    <Sphere ref={meshRef} args={[1, 48, 48]}>
      <meshStandardMaterial color="#4f8cff" wireframe />
    </Sphere>
  );
}

export function Scene3D() {
  return (
    <div className="scene3d" aria-label="3D audio visualization placeholder">
      <Canvas camera={{ position: [0, 0, 3.5], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 4, 4]} intensity={1.2} />
        <AudioSphere />
        <OrbitControls enableZoom={false} />
      </Canvas>
    </div>
  );
}
