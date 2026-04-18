const axios = require('axios');

const API_BASE = 'https://www.qqmp3.vip';

const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.qqmp3.vip/',
    'Origin': 'https://www.qqmp3.vip'
};

// 辅助函数：解码 HTML 实体 (去除 &nbsp; 等)
function decodeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, ''); // 去除零宽字符
}

// 🔧 内存缓存：用于在播放时找回丢失的元数据
const searchCache = new Map();

async function search(query, page, type) {
    if (type !== 'music') {
        return { isEnd: true, data: [] };
    }

    try {
        const response = await axios.get(`${API_BASE}/api/songs.php`, {
            params: { type: 'search', keyword: query },
            headers: commonHeaders,
            timeout: 10000
        });

        const resData = response.data;
        if (resData.code === 200 && Array.isArray(resData.data)) {
            const results = resData.data.filter(item => item.rid).map(item => {
                const name = decodeHtml(item.name || item.title || '').trim();
                const artist = decodeHtml(item.artist || item.singer || '').trim();
                const song = {
                    id: String(item.rid),
                    title: name || '未知歌曲',
                    name: name || '未知歌曲',
                    artist: artist || '未知歌手',
                    album: artist,
                    artwork: item.pic || '',
                    img: item.pic || '',
                    rid: String(item.rid)
                };
                // 将信息存入缓存
                searchCache.set(song.id, song);
                return song;
            });
            return {
                isEnd: true,
                data: results
            };
        }
    } catch (e) {}

    return { isEnd: true, data: [] };
}

async function getMediaSource(musicItem, quality) {
    try {
        // 从缓存恢复完整信息，如果缓存没有，则使用传入的对象
        const id = String(musicItem.id || musicItem.rid);
        const cached = searchCache.get(id);
        const effectiveItem = cached || musicItem;

        const response = await axios.get(`${API_BASE}/api/kw.php`, {
            params: {
                rid: effectiveItem.rid || effectiveItem.id,
                type: 'json',
                level: 'exhigh'
            },
            headers: commonHeaders,
            timeout: 10000
        });

        const resData = response.data;
        let url = '';

        if (resData.url) {
            url = resData.url;
        } else if (resData.data) {
            if (typeof resData.data === 'string' && resData.data.startsWith('http')) {
                url = resData.data;
            } else if (resData.data.url) {
                url = resData.data.url;
            }
        }

        if (url) {
            // 关键：强制返回完整字段，防止被 MusicFree 覆盖为“未命名”
            return {
                url: url,
                title: effectiveItem.title || effectiveItem.name,
                name: effectiveItem.name || effectiveItem.title,
                artist: effectiveItem.artist,
                album: effectiveItem.album,
                artwork: effectiveItem.artwork || effectiveItem.img,
                img: effectiveItem.img || effectiveItem.artwork,
                id: effectiveItem.id
            };
        }
    } catch (e) {}
    return null;
}

async function getLyric(musicItem) {
    try {
        const id = String(musicItem.id || musicItem.rid);
        const cached = searchCache.get(id);
        const effectiveItem = cached || musicItem;

        const response = await axios.get(`${API_BASE}/api/kw.php`, {
            params: {
                rid: effectiveItem.rid || effectiveItem.id,
                type: 'json',
                lrc: 'true'
            },
            headers: commonHeaders,
            timeout: 10000
        });

        const resData = response.data;
        let lrc = '';

        if (resData.lrc) {
            lrc = resData.lrc;
        } else if (resData.lyric) {
            lrc = resData.lyric;
        } else if (resData.data) {
            if (typeof resData.data === 'string' && resData.data.includes('[')) {
                lrc = resData.data;
            } else if (resData.data.lrc) {
                lrc = resData.data.lrc;
            } else if (resData.data.lyric) {
                lrc = resData.data.lyric;
            }
        }

        if (lrc) {
            // 处理转义换行符 \\n 和标准换行符 \n
            lrc = lrc.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
            lrc = decodeHtml(lrc).trim();
            return { lyric: lrc };
        }
    } catch (e) {}
    return { lyric: '' };
}

async function getTopList() {
    try {
        const response = await axios.get(`${API_BASE}/api/songs.php`, {
            headers: commonHeaders,
            timeout: 10000
        });
        const resData = response.data;
        if (resData.code === 200 && Array.isArray(resData.data)) {
            const songs = resData.data.filter(item => item.rid).map(item => {
                const name = decodeHtml(item.name || item.title || '').trim();
                const artist = decodeHtml(item.artist || item.singer || '').trim();
                const song = {
                    id: String(item.rid),
                    title: name || '未知歌曲',
                    name: name || '未知歌曲',
                    artist: artist || '未知歌手',
                    album: artist,
                    artwork: item.pic || '',
                    img: item.pic || '',
                    rid: String(item.rid)
                };
                searchCache.set(song.id, song);
                return song;
            });
            return [{
                id: 'hot',
                name: '热门榜单',
                data: songs
            }];
        }
    } catch (e) {}
    return [];
}

async function getTopListDetail(topListItem) {
    return topListItem;
}

module.exports = {
    platform: '米兔音乐 (qqmp3.vip)',
    author: 'Junie',
    version: '0.1.4',
    srcUrl: 'https://www.qqmp3.vip',
    primaryKey: ['id'],
    cacheControl: 'no-cache',
    search,
    getMediaSource,
    getLyric,
    getTopList,
    getTopListDetail
};
