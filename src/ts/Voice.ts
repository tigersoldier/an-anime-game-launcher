import type { PreDownloadGame, VoicePack, Game as GameData } from './types/GameData';
import type { VoiceLang, InstalledVoice } from './types/Voice';

import type { Stream as DownloadingStream } from '@empathize/framework/dist/network/Downloader';

import { Configs, Debug, Downloader, promisify, path } from '../empathize';
import { DebugThread } from '@empathize/framework/dist/meta/Debug';

import constants from './Constants';
import Game from './Game';
import AbstractInstaller from './core/AbstractInstaller';
import { isDownloaded, resolveDownloadTarget } from './core/Download';

declare const Neutralino;

class Stream extends AbstractInstaller
{
    public constructor(uri: string, skipUnpack: boolean = false)
    {
        super(uri, constants.paths.gameDir, skipUnpack);
    }
}

/**
 * List of voiceover sizes
 */
const VOICE_PACKAGES_SIZES = {
    '3.4.0': {
        'en-us': 9702104595,
        'ja-jp': 10879201351,
        'ko-kr': 8329592851,
        'zh-cn': 8498622343
    },
    '3.3.0': {
        'en-us': 9183929971,
        'ja-jp': 10250403911,
        'ko-kr': 7896362859,
        'zh-cn': 8047012675
    },
    '3.2.0': {
        'en-us': 8636001252,
        'ja-jp': 9600770928,
        'ko-kr': 7416414724,
        'zh-cn': 7563358032
    }
};

function wma_predict(values: number[]): number
{
    switch (values.length)
    {
        case 0:
            return 0;

        case 1:
            return values[0];

        case 2:
            return values[1] * (values[1] / values[0]);

        default:
            let weighted_sum = 0, weighted_delim = 0;

            for (let i = 0; i < values.length - 1; ++i)
            {
                weighted_sum += values[i + 1] / values[i] * (values.length - i - 1);
                weighted_delim += values.length - i - 1;
            }

            return values[values.length - 1] * weighted_sum / weighted_delim;
    }
}

function getVoicePackageSizes(locale: VoiceLang): object
{
    let sizes = {};

    for (const version in VOICE_PACKAGES_SIZES)
        sizes[version] = VOICE_PACKAGES_SIZES[version][locale];

    return sizes;
}

export default class Voice
{
    public static readonly langs = {
        'en-us': 'English(US)',
        'ja-jp': 'Japanese',
        'ko-kr': 'Korean',
        'zh-cn': 'Chinese'
    };

    /**
     * Get the list of the installed voice packages
     */
    public static get installed(): Promise<InstalledVoice[]>
    {
        return new Promise((resolve) => {
            Game.getLatestData()
                .then(async (data) => {
                    const voiceDir = await constants.paths.voiceDir;

                    let installedVoices: InstalledVoice[] = [];

                    // Parse installed voice packages
                    Neutralino.filesystem.readDirectory(voiceDir)
                        .then(async (files) => {
                            files = files.filter((file) => file.type == 'DIRECTORY')
                                .map((file) => file.entry);

                            for (const folder of Object.values(this.langs))
                                if (files.includes(folder))
                                {
                                    const locale = Object.keys(this.langs).find((lang) => this.langs[lang] === folder) as VoiceLang;

                                    // If we have a .version file there - read it and return its output
                                    try
                                    {
                                        const version = new Uint8Array(await Neutralino.filesystem.readBinaryFile(`${voiceDir}/${folder}/.version`));

                                        installedVoices.push({
                                            lang: locale,
                                            version: `${version[0]}.${version[1]}.${version[2]}`
                                        } as InstalledVoice);
                                    }

                                    // Otherwise try to predict voiceover's version
                                    catch
                                    {
                                        const actualSize = parseInt((await Neutralino.os.execCommand(`du -b "${path.addSlashes(`${voiceDir}/${folder}`)}"`))
                                            .stdOut.split('\t')[0]);

                                        let sizes = getVoicePackageSizes(locale);

                                        // If latest voice packages sizes aren't listed in `VOICE_PACKAGES_SIZES`
                                        // then we should predict their sizes
                                        if (Object.keys(sizes)[0] != data.game.latest.version)
                                        {
                                            let t = {};

                                            t[data.game.latest.version] = wma_predict(Object.values(sizes).reverse());

                                            sizes = Object.assign(t, sizes);
                                        }

                                        // To predict voice package version we're going through saved voice packages sizes in the `VOICE_PACKAGES_SIZES` constant
                                        // plus predicted voice packages sizes if needed. The version with closest folder size is version we have installed
                                        for (const version in sizes)
                                            if (actualSize > sizes[version] - 512 * 1024 * 1024)
                                            {
                                                installedVoices.push({
                                                    lang: locale,
                                                    version
                                                } as InstalledVoice);

                                                break;
                                            }
                                    }
                                }

                                resolveVoices();
                        })
                        .catch(() => resolveVoices());

                    // Parse active voice package
                    const resolveVoices = () => {
                        Debug.log({
                            function: 'Voice.current',
                            message: `Installed voices: ${installedVoices.map((voice) => `${voice.lang} (${voice.version})`).join(', ')}`
                        });

                        resolve(installedVoices);
                    };
                })
                .catch(() => resolve([]));
        });
    }

    /**
     * Get currently selected voice packages according to the config file
     */
    public static get selected(): Promise<VoiceLang[]>
    {
        return Configs.get('lang.voice') as Promise<VoiceLang[]>;
    }

    /**
     * Get the voice data installation stream
     * 
     * @returns null if the language or the version can't be found
     * @returns rejects Error object if company's servers are unreachable or they responded with an error
     */
    public static async update(lang: VoiceLang, version: string|null = null): Promise<Stream|null>
    {
        Debug.log({
            function: 'Voice.update',
            message: version !== null ?
                `Updating ${lang} voice package from the ${version} version` :
                `Installing ${lang} voice package`
        });

        const latestData = await Game.getLatestData();
        const voicePack = resolveVoicePack(lang, latestData.game, version);
        return voicePack !== null ? new Stream(voicePack.path) : null;
    }

    /**
     * Delete specified voice package
     */
    public static delete(lang: VoiceLang): Promise<void>
    {
        const debugThread = new DebugThread('Voice.delete', `Deleting ${this.langs[lang]} (${lang}) voice package`);
        return new Promise(async (resolve) => {
            const voiceDir = await constants.paths.voiceDir;

            const pipeline = promisify({
                callbacks: [
                    () => Neutralino.os.execCommand(`rm -rf "${path.addSlashes(`${voiceDir}/${this.langs[lang]}`)}"`),

                    (): Promise<void> => new Promise(async (resolve) => {
                        Neutralino.os.execCommand(`rm -f "${path.addSlashes(`${await constants.paths.gameDir}/Audio_${this.langs[lang]}_pkg_version`)}"`)
                            .then(() => resolve());
                    }),

                    (): Promise<void> => new Promise(async (resolve) => {
                        Neutralino.os.execCommand(`sed -i '/${this.langs[lang]}/d' "${path.addSlashes(`${await constants.paths.gameDataDir}/Persistent/audio_lang_14`)}"`)
                            .then(() => resolve());
                    })
                ],
                interval: 200,
                callAtOnce: true
            });
            
            pipeline.then(() => {
                debugThread.log('Voice package deleted');

                resolve();
            });
        });
    }

    /**
     * Pre-download the game's voice update
     * 
     * @param version current game version to download difference from
     * 
     * @returns null if the game pre-downloading is not available or the language wasn't found. Otherwise - downloading stream
     * @returns Error if company's servers are unreachable or they responded with an error
     */
    public static async predownloadUpdate(lang: VoiceLang, version: string|null = null): Promise<Stream|null>
    {
        const debugThread = new DebugThread('Voice.predownloadUpdate', `Predownloading ${lang} game voice data for version ${version}...`)
        const data = await Game.getLatestData();
        if (!data.pre_download_game) {
            debugThread.log(`Missing pre-download data`);
            return null;
        }
        const voicePack = resolveVoicePack(lang, data.pre_download_game, version);
        debugThread.log(`Got voicePack data: ${JSON.stringify(voicePack)}`);

        if (voicePack === null) {
            debugThread.log(`Unable to resolve voice pack`);
            return null;
        }
        debugThread.log(`Downloading update from the path: ${voicePack.path}`);
        return new Stream(voicePack.path, true /* skipUnpack */);
    }

    /**
     * Checks whether the update was downloaded or not
     */
    public static async isUpdatePredownloaded(lang: VoiceLang|VoiceLang[], predownloadData: PreDownloadGame | GameData, version: string | null): Promise<boolean>
    {
        const debugThread = new DebugThread('Voice.isUpdatePredownloaded', `Checking if the voice update is predownloaded from version ${version} and language ${lang}. Data: ${JSON.stringify(predownloadData)}`);

        if (typeof lang === 'string')
        {
            const voicePack = resolveVoicePack(lang, predownloadData, version);

            if (!voicePack)
            {
                debugThread.log(`voice pack not found for langugae ${lang} and version ${version}`);

                return false;
            }

            return await isDownloaded(voicePack);
        }

        else
        {
            let predownloaded = true;

            for (const voiceLang of lang)
                predownloaded &&= await this.isUpdatePredownloaded(voiceLang, predownloadData, version);

            return predownloaded;
        }
    }
}

function resolveVoicePack(lang: VoiceLang, data: PreDownloadGame | GameData, version: string | null): VoicePack | null
{
    const voicePack = resolveDownloadTarget(data, version)
        .voice_packs
        .filter((voice) => voice.language === lang);

    return voicePack[0] ?? null;
}

export { Stream };
