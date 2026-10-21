import { readFileSync } from 'node:fs'
import { UnoBoard, CPU_HZ } from './src/sim/board'
import { parseHex } from './src/sim/hex'
import { Pca9685 } from './src/sim/i2c'
import { Stepper } from './src/sim/parts'
const b = new UnoBoard(parseHex(readFileSync('public/examples/dume.hex', 'utf8')))
const pca = new Pca9685(0x40); b.i2c.add(pca)
const st = new Stepper(b, 2, 3, 7200)
let out = ''; b.onSerial = (x) => (out += String.fromCharCode(x))
const send = (l: string) => { for (const c of l + '\n') b.serialWrite(c.charCodeAt(0)) }
const show = (l: string) => {
  const ang = (ch: number, r = 180) => { const us = pca.pulseUs(ch); return us ? ((us - 500) / 2000 * r).toFixed(1) : '-' }
  console.log(l, `| freq ${pca.freqHz.toFixed(2)}Hz Y=${ang(1)} Z=${ang(2)} G=${ang(3)} W=${ang(4, 270)} R=${ang(5)} X=${(90 + st.angleDeg).toFixed(1)}`)
}
const t0 = performance.now()
b.run(CPU_HZ * 1); show('boot 1s')
send('PING'); b.run(CPU_HZ * 0.3)
send('MODE,PLAY'); send('MOVE,45,100,135,60,90,1'); b.run(CPU_HZ * 4); show('MOVE 45,100,135,60,90,1 after 4s')
send('HOME'); b.run(CPU_HZ * 5); show('HOME after 5s')
console.log('wall ms for 10.3 sim s:', Math.round(performance.now() - t0))
console.log(JSON.stringify(out.split('\r\n').filter((l) => !l.startsWith('POS')).slice(0, 12)))
console.log('last POS:', out.trim().split('\r\n').filter((l) => l.startsWith('POS')).pop())
