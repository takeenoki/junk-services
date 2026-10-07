export async function handleAboutMe(
    request: Request,
    db: D1Database
): Promise<Response> {
    const requestId = crypto.randomUUID();

    try {
        const accessCount = await db.prepare(`
            UPDATE about_me
            SET access_count = access_count + 1
            WHERE id = 1
            RETURNING access_count
        `).first<number>("access_count");

        if (accessCount == null) {
            console.error("about_meにデータが投入されていません。")
            return Response.json(
                { error: "自己紹介情報の取得に失敗しました。" },
                { status: 500, headers: {
                    "Content-Type": "application/json",
                    "X-Request-ID": requestId
                }}
            );
        }

        return new Response(JSON.stringify({
            url: request.url,
            accessCount: accessCount
        }), {
            headers: {
                "Content-Type": "application/json",
                "X-Request-ID": requestId
            }
        });
    } catch (error) {
        console.error("自己紹介情報の取得に失敗しました。", error)
        return Response.json(
            { error: "自己紹介情報の取得に失敗しました。" },
            { status: 500, headers: {
                "Content-Type": "application/json",
                "X-Request-ID": requestId
            }}
        );
    }
}