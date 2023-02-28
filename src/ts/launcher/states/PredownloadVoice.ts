import { Debug } from '@empathize/framework';
import type Launcher from '../../Launcher';
import type { VoiceLang } from '../../types/Voice';
import Voice from '../../Voice';

export default async (launcher: Launcher): Promise<void> => {
    let packagesVersions = {};

    for (const installedVoice of await Voice.installed) {
        packagesVersions[installedVoice.lang] = installedVoice.version;
    }

    const selected = await Voice.selected;
    for (let selectedVoice of selected) {
        Debug.log(`Downloading voice ${selectedVoice}`);
        await predownloadVoice(launcher, packagesVersions[selectedVoice] ?? null, selectedVoice);
    }
};

function predownloadVoice(launcher: Launcher, version: string|null, selectedVoice: VoiceLang): Promise<void> {
    return new Promise((resolve) => {
        Voice.predownloadUpdate(selectedVoice, version).then((stream) => {
            launcher.progressBar?.init({
                label: `Pre-downloading ${selectedVoice} voice package...`,
                showSpeed: true,
                showEta: true,
                showPercents: true,
                showTotals: true
            });

            stream?.downloadStart(() => launcher.progressBar?.show());

            stream?.downloadProgress((current: number, total: number, difference: number) => {
                launcher.progressBar?.update(current, total, difference);
            });

            stream?.downloadFinish(() => {
                launcher.progressBar?.hide();
                resolve();
            });
        });
    });
}
