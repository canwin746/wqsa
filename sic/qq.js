const axios = require('axios');
const CryptoJs = require('crypto-js');

const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://y.qq.com/',
};

const pageSize = 20;

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

function pickFirstArray(...values) {
    for (const value of values) {
        if (Array.isArray(value) && value.length > 0) {
            return value;
        }
    }
    return [];
}

function getMetaSum(metaHolder, list) {
    const sum = metaHolder?.meta?.sum
        || metaHolder?.meta?.total
        || metaHolder?.sum
        || metaHolder?.total
        || metaHolder?.totalNum
        || metaHolder?.cur_song_num;
    return typeof sum === 'number' ? sum : list.length;
}

function formatMusicItem(_) {
    const albumid = _.albumid || (_.album ? _.album.id : undefined);
    const albummid = _.albummid || (_.album ? _.album.mid : undefined);
    const albumname = _.albumname || (_.album ? _.album.title : undefined) || (_.album ? _.album.name : undefined);
    const singer = toArray(_.singer || _.singer_list || _.singerList || _.artists);
    
    return {
        id: String(_.id || _.songid || _.mid),
        mid: _.mid || _.songmid,
        songmid: _.mid || _.songmid,
        title: _.title || _.songname || _.name,
        artist: singer.map((s) => s.name).join(", "),
        artwork: albummid
            ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albummid}.jpg`
            : undefined,
        album: albumname,
        lrc: _.lyric || undefined,
        duration: _.interval || _.duration,
        albumid: albumid,
        albummid: albummid,
    };
}

function formatAlbumItem(_) {
    return {
        id: String(_.albumID || _.albumid || _.id),
        albumMID: _.albumMID || _.album_mid || _.mid,
        title: _.albumName || _.album_name || _.name || _.title,
        artwork: _.albumPic || (_.album_mid || _.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${_.album_mid || _.mid}.jpg` : undefined),
        date: _.publicTime || _.pub_time || _.publish_date,
        artist: _.singerName || _.singer_name || (_.singer ? _.singer.map(s => s.name).join(', ') : undefined),
        description: _.desc,
    };
}

function formatArtistItem(_) {
    return {
        name: _.singerName || _.name,
        id: String(_.singerID || _.id),
        singerMID: _.singerMID || _.mid,
        avatar: _.singerPic || (_.mid ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${_.mid}.jpg` : undefined),
        worksNum: _.songNum,
    };
}

const searchTypeMap = {
    music: 0,
    album: 2,
    artist: 1,
    sheet: 3,
    lyric: 7
};

async function search(query, page, type) {
    const searchType = searchTypeMap[type] || 0;
    try {
        const res = (await axios({
            url: "https://u.y.qq.com/cgi-bin/musicu.fcg",
            method: "POST",
            data: {
                req_1: {
                    method: "DoSearchForQQMusicDesktop",
                    module: "music.search.SearchCgiService",
                    param: {
                        num_per_page: pageSize,
                        page_num: page || 1,
                        query: query,
                        search_type: searchType,
                    },
                },
            },
            headers: {
                ...commonHeaders,
                'Content-Type': 'application/json'
            },
            xsrfCookieName: "XSRF-TOKEN",
            withCredentials: true,
            timeout: 10000
        })).data;

        const dataBody = res.req_1.data.body;
        let results = [];
        let isEnd = true;

        if (!dataBody) {
            return { isEnd: true, data: [] };
        }

        if (type === 'music' || type === 'lyric') {
            const songData = dataBody.song || dataBody.songInfo || dataBody;
            const songList = pickFirstArray(
                songData?.list,
                songData?.songInfoList,
                songData?.item_song,
                songData?.itemSong,
                dataBody?.list
            );
            if (!songData || songList.length === 0) {
                return { isEnd: true, data: [] };
            }
            results = songList.map(formatMusicItem);
            isEnd = getMetaSum(songData, songList) <= page * pageSize;
            if (type === 'lyric') {
                results = results.map((item, index) => {
                    item.rawLrcTxt = songList[index]?.content || songList[index]?.lyric || '';
                    return item;
                });
            }
        } else if (type === 'album') {
            const albumData = dataBody.album || dataBody;
            const albumList = pickFirstArray(albumData?.list, albumData?.albumList, dataBody?.list);
            results = albumList.map(formatAlbumItem);
            isEnd = getMetaSum(albumData, albumList) <= page * pageSize;
        } else if (type === 'artist') {
            const artistData = dataBody.singer || dataBody.artist || dataBody;
            const artistList = pickFirstArray(artistData?.list, artistData?.singerList, dataBody?.list);
            results = artistList.map(formatArtistItem);
            isEnd = getMetaSum(artistData, artistList) <= page * pageSize;
        } else if (type === 'sheet') {
            const sheetData = dataBody.songlist || dataBody.songList || dataBody;
            const sheetList = pickFirstArray(sheetData?.list, sheetData?.songlist, dataBody?.list);
            results = sheetList.map(item => ({
                title: item.dissname,
                createAt: item.createtime,
                description: item.introduction,
                playCount: item.listennum,
                worksNums: item.song_count,
                artwork: item.imgurl,
                id: String(item.dissid),
                artist: item.creator.name,
            }));
            isEnd = getMetaSum(sheetData, sheetList) <= page * pageSize;
        }

        return {
            isEnd,
            data: results,
        };
    } catch (e) {
        console.error('Search error:', e);
        return { isEnd: true, data: [] };
    }
}

async function getMediaSource(musicItem, quality) {
    const qualityLevels = {
        low: "128k",
        standard: "320k",
        high: "320k",
        super: "320k",
    };
    const mid = musicItem.mid || musicItem.songmid || musicItem.id;
    try {
        // 使用外部 API 作为主要来源，因为本地 vkey 鉴权极易失败
        const res = (await axios.get(`https://lxmusicapi.onrender.com/url/tx/${mid}/${qualityLevels[quality]}`, {
            headers: {
                "X-Request-Key": "share-v3"
            },
            timeout: 10000
        })).data;
        
        if (res.url) {
            return {
                url: res.url,
            };
        }
    } catch (e) {
        console.error('getMediaSource error:', e);
    }
    return null;
}

async function getLyric(musicItem) {
    const mid = musicItem.mid || musicItem.songmid || musicItem.id;
    try {
        const response = await axios.get('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
            params: {
                songmid: mid,
                format: 'json',
                nobase64: 1,
                g_tk: 5381
            },
            headers: {
                ...commonHeaders,
                'Referer': 'https://y.qq.com/portal/player.html'
            },
            timeout: 10000
        });

        const resData = response.data;
        if (resData.code === 0 && resData.lyric) {
            let lyric = resData.lyric.replace(/&apos;/g, "'")
                                       .replace(/&quot;/g, '"')
                                       .replace(/&nbsp;/g, ' ')
                                       .replace(/&gt;/g, '>')
                                       .replace(/&lt;/g, '<')
                                       .replace(/&amp;/g, '&');
            return {
                rawLrc: lyric,
                lyric: lyric
            };
        }
    } catch (e) {
        console.error('getLyric error:', e);
    }
    return { lyric: '', rawLrc: '' };
}

async function getAlbumInfo(albumItem) {
    try {
        const res = (await axios({
            url: "https://u.y.qq.com/cgi-bin/musicu.fcg",
            method: "GET",
            params: {
                data: JSON.stringify({
                    comm: { ct: 24, cv: 10000 },
                    albumSonglist: {
                        method: "GetAlbumSongList",
                        param: { albumMid: albumItem.albumMID || albumItem.id, begin: 0, num: 999, order: 2 },
                        module: "music.musichallAlbum.AlbumSongList",
                    },
                })
            },
            headers: commonHeaders
        })).data;

        return {
            musicList: res.albumSonglist.data.songList.map(item => formatMusicItem(item.songInfo)),
        };
    } catch (e) {
        return { musicList: [] };
    }
}

async function getTopLists() {
    try {
        const list = await axios.get("https://u.y.qq.com/cgi-bin/musicu.fcg", {
            params: {
                data: JSON.stringify({
                    comm: { g_tk: 5381, uin: 0, format: "json", platform: "h5", ct: 23, cv: 0 },
                    topList: { module: "musicToplist.ToplistInfoServer", method: "GetAll", param: {} }
                })
            },
            headers: commonHeaders
        });
        return list.data.topList.data.group.map((e) => ({
            title: e.groupName,
            data: e.toplist.map((_) => ({
                id: String(_.topId),
                description: _.intro,
                title: _.title,
                period: _.period,
                artwork: _.headPicUrl || _.frontPicUrl,
            })),
        }));
    } catch (e) {
        return [];
    }
}

async function getTopListDetail(topListItem) {
    try {
        const res = await axios.get("https://u.y.qq.com/cgi-bin/musicu.fcg", {
            params: {
                data: JSON.stringify({
                    detail: {
                        module: "musicToplist.ToplistInfoServer",
                        method: "GetDetail",
                        param: { topId: parseInt(topListItem.id), offset: 0, num: 100, period: topListItem.period || "" }
                    },
                    comm: { ct: 24, cv: 0 }
                })
            },
            headers: commonHeaders
        });
        return {
            ...topListItem,
            musicList: res.data.detail.data.songInfoList.map(formatMusicItem)
        };
    } catch (e) {
        return topListItem;
    }
}

async function importMusicSheet(urlLike) {
    let id = (urlLike.match(/id=([0-9]+)/) || urlLike.match(/playlist\/([0-9]+)/) || urlLike.match(/^(\d+)$/) || [])[1];
    if (!id) return [];
    
    try {
        const result = (await axios.get(`http://i.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&utf8=1&disstid=${id}&loginUin=0`, {
            headers: { Referer: "https://y.qq.com/n/yqq/playlist" }
        })).data;
        const res = JSON.parse(result.replace(/callback\(|MusicJsonCallback\(|jsonCallback\(|\)$/g, ""));
        return res.cdlist[0].songlist.map(formatMusicItem);
    } catch (e) {
        return [];
    }
}

module.exports = {
    platform: '腾讯音乐',
    author: 'Junie',
    version: '0.3.3',
    srcUrl: 'https://y.qq.com',
    primaryKey: ['id'],
    supportedSearchType: ["music", "album", "sheet", "artist", "lyric"],
    async search(query, page, type) {
        let res = await search(query, page, type);
        if (type === 'music' && (!res || !res.data || res.data.length < pageSize)) {
            // fallback to smartbox
            try {
                const smartRes = (await axios.get('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg', {
                    params: {
                        format: 'json',
                        key: query,
                        g_tk: 5381
                    },
                    headers: commonHeaders,
                    timeout: 5000
                })).data;
                if (smartRes.code === 0 && smartRes.data && smartRes.data.song) {
                    const songs = smartRes.data.song.itemlist.map(item => ({
                        id: String(item.id),
                        mid: item.mid,
                        songmid: item.mid,
                        title: item.name,
                        artist: item.singer,
                        artwork: item.album_mid
                            ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${item.album_mid}.jpg`
                            : item.pic || item.cover || undefined,
                        album: item.album || item.album_name || '',
                        albumid: item.album_id,
                        albummid: item.album_mid,
                    }));
                    const merged = (res?.data || []).slice();
                    const seen = new Set(merged.map(item => item.id));
                    for (const song of songs) {
                        if (!seen.has(song.id)) {
                            merged.push(song);
                            seen.add(song.id);
                        }
                    }
                    return { isEnd: merged.length < pageSize, data: merged };
                }
            } catch (e) {
                console.error('Fallback search error:', e);
            }
        }
        return res;
    },
    getMediaSource,
    getLyric,
    getAlbumInfo,
    importMusicSheet,
    getTopLists,
    getTopListDetail,
};
