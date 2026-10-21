import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { DumePose } from './sim/rig'

export type ScenePose =
  | { kind: 'demo'; servoDeg: number; stepperDeg: number }
  | ({ kind: 'dume' } & DumePose)

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
const deg = THREE.MathUtils.degToRad

/** NEMA-17 stepper with a turntable, and an SG90-style servo with a horn mounted on it. */
function buildDemoRig() {
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

const LOWER = 0.85
const MID = 0.5
const UPPER = 0.85
const GRIPPER = 0.3

/** Schematic DUM-E arm; same hierarchy and angle conventions as the DUM-E web app. */
function buildDumeArm() {
  const rig = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.575, 0.4, 32), mat(0x2b2f36))
  base.position.y = 0.2
  rig.add(base)

  const tower = new THREE.Group() // X: whole tower around the vertical axis
  tower.position.y = 0.4
  rig.add(tower)

  const shoulder = new THREE.Group() // Y
  tower.add(shoulder)
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.25, LOWER, 0.25), mat(0xff8000))
  lower.position.y = LOWER / 2
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.36, 16), mat(0x101015))
  hinge.position.y = LOWER
  hinge.rotation.x = Math.PI / 2
  shoulder.add(lower, hinge)

  const mid = new THREE.Group() // W (0..270, center 135)
  mid.position.y = LOWER
  const midBox = new THREE.Mesh(new THREE.BoxGeometry(0.22, MID, 0.22), mat(0x3ba7ff))
  midBox.position.y = MID / 2
  mid.add(midBox)
  shoulder.add(mid)

  const elbow = new THREE.Group() // Z
  elbow.position.y = MID
  const upperBox = new THREE.Mesh(new THREE.BoxGeometry(0.2, UPPER, 0.2), mat(0xffcc33))
  upperBox.position.y = UPPER / 2
  elbow.add(upperBox)
  mid.add(elbow)

  const wrist = new THREE.Group() // R
  wrist.position.y = UPPER
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), mat(0x101015))
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.03), mat(0xff3b30))
  mark.position.set(0.13, 0.03, 0)
  const fingerL = new THREE.Mesh(new THREE.BoxGeometry(0.06, GRIPPER, 0.12), mat(0xe8e8ec))
  const fingerR = new THREE.Mesh(new THREE.BoxGeometry(0.06, GRIPPER, 0.12), mat(0xe8e8ec))
  fingerL.position.y = fingerR.position.y = GRIPPER / 2 + 0.03
  wrist.add(disc, mark, fingerL, fingerR)
  elbow.add(wrist)

  return { rig, tower, shoulder, mid, elbow, wrist, fingerL, fingerR }
}

export function Viewport({ pose }: { pose: () => ScenePose }) {
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

    const demo = buildDemoRig()
    const dume = buildDumeArm()
    scene.add(demo.rig, dume.rig)

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
      demo.rig.visible = p.kind === 'demo'
      dume.rig.visible = p.kind === 'dume'
      if (p.kind === 'demo') {
        demo.turntable.rotation.y = deg(p.stepperDeg)
        demo.horn.rotation.z = deg(p.servoDeg)
      } else {
        dume.tower.rotation.y = deg(p.x - 90)
        dume.shoulder.rotation.z = deg(p.y - 90)
        dume.mid.rotation.z = deg(p.w - 135)
        dume.elbow.rotation.z = deg(p.z - 90)
        dume.wrist.rotation.y = deg(p.r - 90)
        const offset = p.gripperClosed ? 0.03 : 0.12
        dume.fingerL.position.x = -offset
        dume.fingerR.position.x = offset
      }
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
