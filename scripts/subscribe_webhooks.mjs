/** --status (default) sólo consulta. --apply registra tras verificar el callback. */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createWebhookSetup, BAKO_WEBHOOK_CALLBACK_URL, redactWebhookSetupError } from '../worker/lib/webhook-setup.mjs';

export function parseSetupArguments(args) {
    const options = { mode: 'status', callback: undefined, replaceCallback: false, help: false };
    let explicitMode;
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === '--help' || argument === '-h') options.help = true;
        else if (argument === '--status' || argument === '--apply') {
            const mode = argument.slice(2);
            if (explicitMode && explicitMode !== mode) throw new Error('Elegí --status o --apply, sin combinarlos.');
            explicitMode = options.mode = mode;
        }
        else if (argument === '--replace-callback') options.replaceCallback = true;
        else if (argument === '--callback') {
            const value = args[++index];
            if (!value || value.startsWith('--') || options.callback) throw new Error('Completá --callback una sola vez con la URL del webhook de BAKO.');
            options.callback = value;
        }
        else throw new Error('Argumento no admitido. Consultá --help para ver los comandos.');
    }
    if (options.replaceCallback && options.mode !== 'apply') throw new Error('--replace-callback requiere --apply.');
    return options;
}

export async function main(args = process.argv.slice(2)) {
    try {
        const options = parseSetupArguments(args);
        if (options.help) {
            console.log(`Consultar sin modificar Meta:\n  node scripts/subscribe_webhooks.mjs --status\n\nRegistrar las suscripciones tras verificar BAKO:\n  node scripts/subscribe_webhooks.mjs --apply --callback ${BAKO_WEBHOOK_CALLBACK_URL}\n\nEl callback también se puede indicar mediante META_WEBHOOK_CALLBACK_URL.\nMETA_WEBHOOK_VERIFY_TOKEN debe coincidir con el configurado en el despliegue.\nUn callback existente diferente requiere --replace-callback explícito.`);
            return;
        }
        config({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), quiet: true });
        const setup = createWebhookSetup(process.env);
        const result = options.mode === 'apply'
            ? await setup.apply({ callback: options.callback, replaceCallback: options.replaceCallback })
            : await setup.status();
        console.log(JSON.stringify({ mode: options.mode, ...result }, null, 2));
    } catch (error) {
        console.error(redactWebhookSetupError(error.message, process.env));
        process.exitCode = 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
