import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { PrinterProfile } from '../types'

type Props = {
  positions: Float32Array | null
  printer: PrinterProfile
  wireframe: boolean
}

/**
 * Visualização da peça sobre a mesa da impressora. O JSCAD trabalha com Z para
 * cima, então a câmera do three.js é configurada do mesmo jeito.
 */
export function Viewer({ positions, printer, wireframe }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    controls: OrbitControls
    mesh: THREE.Mesh | null
    bed: THREE.Group
  } | null>(null)

  // Monta a cena uma única vez.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x11161f)

    const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000)
    camera.up.set(0, 0, 1)
    camera.position.set(220, -260, 190)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x30323a, 2.1))

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
    keyLight.position.set(1, -1.4, 1.6)
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.7)
    fillLight.position.set(-1.2, 0.9, 0.5)
    scene.add(fillLight)

    const bed = new THREE.Group()
    scene.add(bed)

    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const resize = () => {
      const { clientWidth, clientHeight } = container
      if (clientWidth === 0 || clientHeight === 0) return
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      // Sem atualizar o estilo, o canvas fica do tamanho do buffer (o dobro em
      // tela retina) e transborda o contêiner.
      renderer.setSize(clientWidth, clientHeight)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    sceneRef.current = { scene, camera, renderer, controls, mesh: null, bed }

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      sceneRef.current = null
    }
  }, [])

  // Desenha a mesa quando o perfil da impressora muda.
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return

    disposeChildren(state.bed)
    state.bed.clear()

    const [bedX, bedY] = printer.bed

    const grid = new THREE.GridHelper(Math.max(bedX, bedY), Math.round(Math.max(bedX, bedY) / 10))
    grid.rotation.x = Math.PI / 2
    const gridMaterial = grid.material as THREE.Material & { opacity: number; transparent: boolean }
    gridMaterial.opacity = 0.25
    gridMaterial.transparent = true
    state.bed.add(grid)

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(bedX, bedY)),
      new THREE.LineBasicMaterial({ color: 0x4c7ef3 }),
    )
    state.bed.add(outline)

    const axes = new THREE.AxesHelper(20)
    axes.position.set(-bedX / 2, -bedY / 2, 0.1)
    state.bed.add(axes)
  }, [printer])

  // Troca a malha sempre que sai uma geometria nova.
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return

    if (state.mesh) {
      state.scene.remove(state.mesh)
      state.mesh.geometry.dispose()
      ;(state.mesh.material as THREE.Material).dispose()
      state.mesh = null
    }

    if (!positions || positions.length === 0) return

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    // Sem vértices compartilhados as normais saem por face — o sombreado plano
    // é justamente o que se quer para mostrar peça de CAD.
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    const material = new THREE.MeshStandardMaterial({
      color: 0x6fd3c7,
      metalness: 0.05,
      roughness: 0.55,
      wireframe,
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geometry, material)
    state.scene.add(mesh)
    state.mesh = mesh

    frameCamera(state.camera, state.controls, geometry)
  }, [positions])

  // Alternar wireframe não deve recalcular a geometria nem mover a câmera.
  useEffect(() => {
    const mesh = sceneRef.current?.mesh
    if (mesh) (mesh.material as THREE.MeshStandardMaterial).wireframe = wireframe
  }, [wireframe])

  return <div className="viewer" ref={containerRef} />
}

/** Enquadra a peça inteira, olhando para o centro da sua caixa envolvente. */
function frameCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  geometry: THREE.BufferGeometry,
) {
  const sphere = geometry.boundingSphere
  const box = geometry.boundingBox
  if (!sphere || !box) return

  const center = new THREE.Vector3()
  box.getCenter(center)

  const distance = (sphere.radius * 1.9) / Math.tan((camera.fov * Math.PI) / 360)
  const direction = new THREE.Vector3(0.8, -1, 0.65).normalize()

  camera.position.copy(center).addScaledVector(direction, Math.max(distance, 60))
  camera.near = Math.max(0.5, distance / 200)
  camera.far = distance * 20
  camera.updateProjectionMatrix()

  controls.target.copy(center)
  controls.update()
}

function disposeChildren(group: THREE.Group) {
  for (const child of group.children) {
    const item = child as THREE.Mesh | THREE.LineSegments
    item.geometry?.dispose()
    const material = item.material
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material?.dispose()
  }
}
