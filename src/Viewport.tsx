import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface PoseSource {
  /** Servo shaft angle in degrees (0..180). */
  servoDeg: number
  /** Stepper shaft angle in degrees (unbounded). */
  stepperDeg: number
}

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 })

/** NEMA-17 stepper with a turntable, and an SG90-style servo with a horn mounted on it. */
function buildRig() {
  const rig = new THREE.Group()

  const motor = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.6, 1.7), mat(0x2b2f36))
  motor.position.y = 0.8
  rig.add(motor)

  const turntable = new THREE.Group()
  turntable.position.y = 1.6
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.12, 48), mat(0x9aa4b2))
  disc.position.y = 0.06
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.14, 0.5), mat(0xff5a36))
  marker.position.set(0, 0.13, 0.85)
  turntable.add(disc, marker)

  const servoBody = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.5), mat(0x2f6fdb))
  servoBody.position.set(0, 0.57, 0)
  turntable.add(servoBody)

  const horn = new THREE.Group()
  horn.position.set(0.7, 0.57, 0.3)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.1), mat(0xf2f2f2))
  arm.position.x = 0.7
  horn.add(arm)
  turntable.add(horn)

  rig.add(turntable)
  return { rig, turntable, horn }
}

export function Viewport({ pose }: { pose: () => PoseSource }) {
  const host = useRef<HTMLDivElement>(null)
  const poseRef = useRef(pose)
  useEffect(() => {
    poseRef.current = pose
  })

  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x14171c)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x303640, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(4, 8, 5)
    scene.add(sun)
    scene.add(new THREE.GridHelper(10, 20, 0x3a414c, 0x262b33))

    const { rig, turntable, horn } = buildRig()
    scene.add(rig)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(4.5, 4, 5.5)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.4, 0)
    controls.enableDamping = true

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let raf = 0
    const frame = () => {
      const p = poseRef.current()
      turntable.rotation.y = THREE.MathUtils.degToRad(p.stepperDeg)
      horn.rotation.z = THREE.MathUtils.degToRad(p.servoDeg)
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={host} className="viewport" />
}
