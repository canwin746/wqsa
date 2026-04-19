const axios = require('axios');

const pageSize = 20;
const baseUrl = 'https://music.163.com';

const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://music.163.com/',
    'Origin': 'https://music.163.com',
};

const searchTypeMap = {
    music: 1,
    album: 10,
    artist: 100,
    sheet: 1000,
    lyric: 1006,
};

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

function toHttps(url) {
    if (!url || typeof url !== 'string') {
        return undefined;
    }
    return url.replace(/^http:\/\//i, 'https://');
}

function joinArtistNames(list) {
    return toArray(list).map((item) => item && item.name).filter(Boolean).join(', ');
}

function mergeById(...lists) {
    const merged = [];
    const seen = new Set();
    for (const list of lists) {
        for (const item of toArray(list)) {
            const id = item && item.id != null ? String(item.id) : '';
            if (!id || seen.has(id)) {
                continue;
            }
            seen.add(id);
            merged.push(item);
        }
    }
    return merged;
}

function formatMusicItem(item) {
    const album = item.al || item.album || {};
    const artists = item.ar || item.artists || [];
    const duration = item.dt || item.duration || item.length;
    const mvId = item.mv || item.mvid;

    return {
        id: String(item.id),
        title: item.name,
        artist: joinArtistNames(artists) || item.artist || '未知歌手',
        album: album.name || item.albumName,
        artwork: toHttps(album.picUrl || item.picUrl || item.albumPicUrl),
        duration: duration ? Math.floor(duration / 1000) : undefined,
        mvId: mvId || undefined,
        fee: item.fee,
    };
}

function formatAlbumItem(item) {
    const artistList = item.artists || (item.artist ? [item.artist] : []);
    return {
        id: String(item.id),
        title: item.name,
        artist: joinArtistNames(artistList) || item.artist && item.artist.name,
        artwork: toHttps(item.picUrl || item.blurPicUrl),
        description: item.description,
        createAt: item.publishTime || item.pubTime,
        worksNum: item.size || item.songSize,
    };
}

function formatArtistItem(item) {
    return {
        id: String(item.id),
        name: item.name,
        avatar: toHttps(item.picUrl || item.img1v1Url || item.cover),
        worksNum: item.musicSize || item.albumSize,
    };
}

function formatSheetItem(item) {
    const creator = item.creator || {};
    return {
        id: String(item.id),
        title: item.name,
        artist: creator.nickname || item.creatorName,
        artwork: toHttps(item.coverImgUrl),
        description: item.description,
        worksNum: item.trackCount,
        playCount: item.playCount,
        createAt: item.createTime,
    };
}

async function postForm(url, data) {
    const body = Object.keys(data).map((key) => {
        return `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`;
    }).join('&');

    const response = await axios.post(url, body, {
        headers: {
            ...commonHeaders,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
    });
    return response.data;
}

async function postSearch(data, endpoints) {
    const results = [];
    let lastError;
    for (const endpoint of endpoints) {
        try {
            const result = await postForm(`${baseUrl}${endpoint}`, data);
            if (result && result.code === 200) {
                results.push(result);
                continue;
            }
            lastError = new Error(result && result.message ? result.message : `搜索失败: ${endpoint}`);
        } catch (error) {
            lastError = error;
        }
    }
    if (results.length > 0) {
        return results;
    }
    throw lastError || new Error('搜索失败');
}

async function getJson(url, params) {
    const response = await axios.get(url, {
        params,
        headers: commonHeaders,
        timeout: 10000,
    });
    return response.data;
}

async function getSongDetail(id) {
    const data = await getJson(`${baseUrl}/api/song/detail`, {
        ids: `[${id}]`,
    });
    const song = toArray(data.songs)[0];
    if (!song) {
        throw new Error('未找到歌曲详情');
    }
    return song;
}

async function search(query, page, type) {
    const searchType = searchTypeMap[type];
    if (!searchType) {
        return { isEnd: true, data: [] };
    }

    const offset = (Math.max(page, 1) - 1) * pageSize;
    const searchResults = await postSearch({
        s: query,
        type: searchType,
        limit: pageSize,
        offset,
    }, [
        '/api/search/get/web',
        '/api/cloudsearch/pc',
    ]);

    const resultList = searchResults.map((item) => item.result || {});
    if (type === 'music' || type === 'lyric') {
        const songs = mergeById(...resultList.map((item) => toArray(item.songs))).map(formatMusicItem);
        const total = Math.max(...resultList.map((item) => item.songCount || 0), songs.length);
        return {
            isEnd: offset + songs.length >= total,
            data: songs,
        };
    }
    if (type === 'album') {
        const albums = mergeById(...resultList.map((item) => toArray(item.albums))).map(formatAlbumItem);
        const total = Math.max(...resultList.map((item) => item.albumCount || 0), albums.length);
        return {
            isEnd: offset + albums.length >= total,
            data: albums,
        };
    }
    if (type === 'artist') {
        const artists = mergeById(...resultList.map((item) => toArray(item.artists))).map(formatArtistItem);
        const total = Math.max(...resultList.map((item) => item.artistCount || 0), artists.length);
        return {
            isEnd: offset + artists.length >= total,
            data: artists,
        };
    }

    const sheets = mergeById(...resultList.map((item) => toArray(item.playlists))).map(formatSheetItem);
    const total = Math.max(...resultList.map((item) => item.playlistCount || 0), sheets.length);
    return {
        isEnd: offset + sheets.length >= total,
        data: sheets,
    };
}

async function getMediaSource(musicItem, quality) {
    const brMap = {
        low: 128000,
        standard: 192000,
        high: 320000,
        super: 999000,
    };
    const data = await postForm(`${baseUrl}/api/song/enhance/player/url`, {
        ids: `[${musicItem.id}]`,
        br: brMap[quality] || brMap.standard,
    });
    const source = toArray(data.data)[0];
    if (!source || !source.url) {
        throw new Error('该歌曲在网易云当前不可播放');
    }
    return {
        url: source.url,
        headers: {
            Referer: 'https://music.163.com/',
        },
    };
}

async function getLyric(musicItem) {
    const data = await getJson(`${baseUrl}/api/song/lyric`, {
        id: musicItem.id,
        lv: -1,
        kv: -1,
        tv: -1,
    });

    return {
        rawLrc: data.lrc && data.lrc.lyric ? data.lrc.lyric : '',
        translation: data.tlyric && data.tlyric.lyric ? data.tlyric.lyric : '',
    };
}

async function getMusicInfo(musicItem) {
    const song = await getSongDetail(musicItem.id);
    return formatMusicItem(song);
}

async function getAlbumInfo(albumItem, page) {
    const data = await getJson(`${baseUrl}/api/album/${albumItem.id}`);
    const songs = toArray(data.songs).map(formatMusicItem);
    return {
        isEnd: true,
        musicList: page > 1 ? [] : songs,
        albumItem: page === 1 ? {
            title: data.album && data.album.name,
            artist: joinArtistNames(data.album && data.album.artists),
            artwork: toHttps(data.album && data.album.picUrl),
            description: data.album && data.album.description,
            worksNum: data.album && data.album.size,
            createAt: data.album && data.album.publishTime,
        } : undefined,
    };
}

async function getMusicSheetInfo(sheetItem, page) {
    const data = await getJson(`${baseUrl}/api/v6/playlist/detail`, {
        id: sheetItem.id,
        n: 100000,
        s: 0,
    });
    const playlist = data.playlist || {};
    const allTracks = toArray(playlist.tracks);
    const start = (Math.max(page, 1) - 1) * pageSize;
    const musicList = allTracks.slice(start, start + pageSize).map(formatMusicItem);

    return {
        isEnd: start + musicList.length >= allTracks.length,
        musicList,
        sheetItem: page === 1 ? {
            title: playlist.name,
            artist: playlist.creator && playlist.creator.nickname,
            artwork: toHttps(playlist.coverImgUrl),
            description: playlist.description,
            worksNum: playlist.trackCount,
            playCount: playlist.playCount,
            createAt: playlist.createTime,
        } : undefined,
    };
}

async function getArtistWorks(artistItem, page, type) {
    if (type === 'music') {
        const data = await getJson(`${baseUrl}/api/artist/${artistItem.id}`);
        const songs = toArray(data.hotSongs).map(formatMusicItem);
        const start = (Math.max(page, 1) - 1) * pageSize;
        return {
            isEnd: start + pageSize >= songs.length,
            data: songs.slice(start, start + pageSize),
        };
    }

    if (type === 'album') {
        const offset = (Math.max(page, 1) - 1) * pageSize;
        const data = await getJson(`${baseUrl}/api/artist/albums/${artistItem.id}`, {
            offset,
            limit: pageSize,
        });
        const albums = toArray(data.hotAlbums || data.albumList || data.artist && data.artist.albumList).map(formatAlbumItem);
        const total = data.total || albums.length;
        return {
            isEnd: offset + albums.length >= total,
            data: albums,
        };
    }

    return { isEnd: true, data: [] };
}

async function importMusicItem(urlLike) {
    const id = (String(urlLike).match(/song\?id=(\d+)/) || String(urlLike).match(/song\/(\d+)/) || String(urlLike).match(/^(\d+)$/) || [])[1];
    if (!id) {
        throw new Error('无法识别歌曲链接或歌曲 ID');
    }
    const song = await getSongDetail(id);
    return formatMusicItem(song);
}

async function importMusicSheet(urlLike) {
    const id = (String(urlLike).match(/playlist\?id=(\d+)/) || String(urlLike).match(/playlist\/(\d+)/) || String(urlLike).match(/^(\d+)$/) || [])[1];
    if (!id) {
        throw new Error('无法识别歌单链接或歌单 ID');
    }
    const data = await getJson(`${baseUrl}/api/v6/playlist/detail`, {
        id,
        n: 100000,
        s: 0,
    });
    return toArray(data.playlist && data.playlist.tracks).map(formatMusicItem);
}

async function getTopLists() {
    const data = await getJson(`${baseUrl}/api/toplist`);
    return [{
        title: '网易云榜单',
        data: toArray(data.list).map((item) => ({
            id: String(item.id),
            title: item.name,
            artwork: toHttps(item.coverImgUrl),
            description: item.description,
            playCount: item.playCount,
            worksNum: item.trackCount,
            updateFrequency: item.updateFrequency,
        })),
    }];
}

async function getTopListDetail(topListItem, page) {
    const detail = await getMusicSheetInfo(topListItem, page);
    return {
        isEnd: detail.isEnd,
        musicList: detail.musicList,
        topListItem: page === 1 ? {
            ...topListItem,
            ...(detail.sheetItem || {}),
        } : undefined,
    };
}

module.exports = {
    platform: '网易云音乐',
    author: 'Codex',
    version: '0.1.0',
    cacheControl: 'no-store',
    srcUrl: 'https://music.163.com',
    supportedSearchType: ['music', 'album', 'artist', 'sheet', 'lyric'],
    hints: {
        importMusicItem: [
            '支持歌曲链接或纯数字歌曲 ID',
            '示例: https://music.163.com/#/song?id=347230',
        ],
        importMusicSheet: [
            '支持歌单链接或纯数字歌单 ID',
            '示例: https://music.163.com/#/playlist?id=24381616',
        ],
    },
    search,
    getMediaSource,
    getLyric,
    getMusicInfo,
    getAlbumInfo,
    getMusicSheetInfo,
    getArtistWorks,
    importMusicItem,
    importMusicSheet,
    getTopLists,
    getTopListDetail,
};
