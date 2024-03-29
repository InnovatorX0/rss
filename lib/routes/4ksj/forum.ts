import { Route } from '@/types';
import { getCurrentPath } from '@/utils/helpers';
const __dirname = getCurrentPath(import.meta.url);

import cache from '@/utils/cache';
import got from '@/utils/got';
import { load } from 'cheerio';
import timezone from '@/utils/timezone';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
import * as path from 'node:path';
import iconv from 'iconv-lite';

export const route: Route = {
    path: '/forum/:id?',
    categories: ['multimedia'],
    example: '/4ksj/forum',
    parameters: { id: '分类 id，默认为最新4K电影' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '分类',
    maintainers: ['nczitzk'],
    handler,
    description: `:::tip
  若订阅 [最新 4K 电影](https://www.4ksj.com/forum-2-1.html)，网址为 \`https://www.4ksj.com/forum-2-1.html\`。截取 \`https://www.4ksj.com/forum-\` 到末尾 \`.html\` 的部分 \`2-1\` 作为参数，此时路由为 [\`/4ksj/forum/2-1\`](https://rsshub.app/4ksj/forum/2-1)。

  若订阅子分类 [Dolby Vision 纪录片 4K 电影](https://www.4ksj.com/forum-4kdianying-s7-dianyingbiaozhun-3-dytypes-9-1.html)，网址为 \`https://www.4ksj.com/forum-4kdianying-s7-dianyingbiaozhun-3-dytypes-9-1.html\`。截取 \`https://www.4ksj.com/forum-\` 到末尾 \`.html\` 的部分 \`4kdianying-s7-dianyingbiaozhun-3-dytypes-9-1\` 作为参数，此时路由为 [\`/4ksj/forum/4kdianying-s7-dianyingbiaozhun-3-dytypes-9-1\`](https://rsshub.app/4ksj/forum/4kdianying-s7-dianyingbiaozhun-3-dytypes-9-1)。
  :::`,
};

async function handler(ctx) {
    const id = ctx.req.param('id') ?? '2-1';
    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit')) : 25;

    const rootUrl = 'https://www.4ksj.com';
    const currentUrl = `${rootUrl}/forum-${id}.html`;

    const response = await got({
        method: 'get',
        url: currentUrl,
        responseType: 'buffer',
    });

    const $ = load(iconv.decode(response.data, 'gbk'));

    let items = $('div.nex_cmo_piv a')
        .slice(0, limit)
        .toArray()
        .map((item) => {
            item = $(item);

            return {
                link: new URL(item.attr('href'), rootUrl).href,
            };
        });

    items = await Promise.all(
        items.map((item) =>
            cache.tryGet(item.link, async () => {
                const detailResponse = await got({
                    method: 'get',
                    url: item.link,
                    responseType: 'buffer',
                });

                const content = load(iconv.decode(detailResponse.data, 'gbk'));

                const details = {};
                const links = {};

                content('.nex_drama_Details')
                    .find('em')
                    .each(function () {
                        const detail = content(this).parent();
                        const key = content(this).text();
                        const value = detail.text().replace(key, '').replaceAll('&nbsp;', '').trim();
                        if (value) {
                            details[key.replaceAll(/：|\s/g, '')] = value;
                        }
                    });

                content('.nex_netdrivelink, .nex_xunleilink').each(function () {
                    links[content(this).text()] = content(this).next().html();
                });

                content('.nex_drama_intros em').first().remove();
                content('.nex_thread_author_name em').first().remove();
                content('.xg1 a').remove();

                const matches = content('.nex_drama_Top em')
                    .text()
                    .match(/(.*?)（豆瓣：(.*?)）/);

                item.title = content('.nex_drama_Top h5').text();
                item.author = content('.nex_thread_author_name').text();
                item.pubDate = timezone(parseDate(content('.nex_ifpost em').text().replaceAll('发表于', '').trim(), 'YYYY-M-D HH:mm'), +8);
                item.category = Object.values(details).map((d) => d.replaceAll('&nbsp;', '').trim());
                item.description = art(path.join(__dirname, 'templates/description.art'), {
                    picture: content('.nex_drama_pic')
                        .html()
                        .match(/background:url\((.*?)\)/)[1],
                    name: item.title,
                    time: matches[1],
                    score: matches[2],
                    details,
                    detailKeys: Object.keys(details),
                    intro: content('.nex_drama_intros').html(),
                    links,
                    linkKeys: Object.keys(links),
                    bt: content('.t_f').html(),
                    info: content('.nex_drama_sums').html(),
                });

                const magnets = content('.t_f a')
                    .toArray()
                    .filter((a) => content(a).attr('href').startsWith('magnet'))
                    .map((a) => content(a).attr('href'));

                if (magnets.length > 0) {
                    item.enclosure_url = magnets[0];
                    item.enclosure_type = 'application/x-bittorrent';
                }

                return item;
            })
        )
    );

    return {
        title: `4k世界 - ${$('#fontsearch ul.cl li.a')
            .toArray()
            .map((a) => $(a).text())
            .join('+')}`,
        link: currentUrl,
        item: items,
    };
}
