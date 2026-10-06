interface JumpTitle {
  title: string;
  title_url: string | null;
  author: string;
  author_url: string | null;
  start_issue: string;
  end_issue: string;
}

export async function handleRandomJumpTitle(
  request: Request,
  db: D1Database,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };

  if (request.method !== "GET") {
    return Response.json(
      { error: "GETメソッドを使用してください。" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  }

  try {
    const title = await db.prepare(`
      SELECT title, title_url, author, author_url, start_issue, end_issue
      FROM "jump-titles"
      ORDER BY RANDOM()
      LIMIT 1
    `).first<JumpTitle>();

    if (!title) {
      return Response.json(
        { error: "作品データが登録されていません。" },
        { status: 404, headers },
      );
    }

    return Response.json(title, { headers });
  } catch (error) {
    console.error("ジャンプ作品の取得に失敗しました。", error);
    return Response.json(
      { error: "作品情報を取得できませんでした。時間をおいて再度お試しください。" },
      { status: 500, headers },
    );
  }
}
