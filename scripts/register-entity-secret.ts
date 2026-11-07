/**
 * One-time: generate an entity secret, register its ciphertext with Circle,
 * save the recovery file under .circle/, and append the secret to .env.
 * The secret is never printed.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from '@circle-fin/developer-controlled-wallets'

const apiKey = process.env.CIRCLE_API_KEY
if (!apiKey) throw new Error('CIRCLE_API_KEY is not set')
if (process.env.CIRCLE_ENTITY_SECRET) throw new Error('An entity secret is already configured')

const recoveryDir = path.join(process.cwd(), '.circle')
fs.mkdirSync(recoveryDir, { recursive: true })

const entitySecret = crypto.randomBytes(32).toString('hex')
const response = await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: recoveryDir,
})

const recoveryPath = path.join(recoveryDir, 'recovery_file.dat')
if (response.data?.recoveryFile && !fs.existsSync(recoveryPath)) {
  fs.writeFileSync(recoveryPath, response.data.recoveryFile)
}
fs.appendFileSync(path.join(process.cwd(), '.env'), `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`, 'utf-8')

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })
await client.listWalletSets({ pageSize: 1 })
console.log('registered: true')
console.log('recovery file written:', fs.existsSync(recoveryPath))
