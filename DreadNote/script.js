import { getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, deleteDoc} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let metaCache = null;        // ← 目次箱
const memoCache = {};       // ← 本文キャッシュ

/* Firebase初期化 */
const firebaseConfig = { apiKey: "AIzaSyCdDf0GH80PoGlcbk2yjlaVQfP01Gk9m18", authDomain: "noteeditor-ba1db.firebaseapp.com", projectId: "noteeditor-ba1db" };
const app = initializeApp( firebaseConfig );
const auth = getAuth( app );
const db = getFirestore( app );

/* DOM要素 */
const views = { login: document.getElementById( 'view-login' ), list: document.getElementById( 'view-list' ), trash: document.getElementById( 'view-trash' ), editor: document.getElementById( 'view-editor' ) };
// const emailInput = document.getElementById( 'email' );
// const passwordInput = document.getElementById( 'password' );
const memoList = document.getElementById( 'memo-list' );
const trashList = document.getElementById( 'trash-list' );
const editor = document.getElementById( 'editor' );
const titleInput = document.getElementById( 'title' );
const userIcon = document.getElementById( 'user-icon' );
const userMenu = document.getElementById( 'user-menu' );

// Dark mode toggle
const darkBtn = document.getElementById( 'dark-btn' );

if ( darkBtn ) {
	darkBtn.onclick = ( e ) => {
		e.stopPropagation();
		document.body.classList.toggle( 'dark' );
		localStorage.setItem(
			'dreadnote-dark',
			document.body.classList.contains( 'dark' ) ? '1' : '0'
		);
	};
}
// Spread mode toggle
const spreadBtn = document.getElementById( 'spread-btn' );

if ( spreadBtn ) {
	spreadBtn.onclick = ( e ) => {
		e.stopPropagation();
		document.body.classList.toggle( 'spread' );
		localStorage.setItem(
			'dreadnote-spread',
			document.body.classList.contains( 'spread' ) ? '1' : '0'
		);
	};
}

// 初期化（保存状態を反映）
if ( localStorage.getItem( 'dreadnote-dark' ) === '1' ) {
	document.body.classList.add( 'dark' );
}
if ( localStorage.getItem( 'dreadnote-spread' ) === '1' ) {
	document.body.classList.add( 'spread' );
}
const toast = document.getElementById( 'toast' );
const preview = document.getElementById( 'preview' );
const previewContent = document.getElementById( 'preview-content' );
const copyBtn = document.getElementById( 'copy-note' );
const deleteBtn = document.getElementById( 'delete-note' );
const closePreview = document.getElementById( 'close-preview' );

let currentMemoId = null;
let longPressTimer = null;
// let memosCache=[];

/* トースト表示 */
function showToast( msg, d = 2000 ) { toast.textContent = msg; toast.classList.add( 'show' ); setTimeout( () => toast.classList.remove( 'show' ), d ); }
function show( view ) { Object.values( views ).forEach( v => v.hidden = true ); views[view].hidden = false; }

/* Auth */
const provider = new GoogleAuthProvider();
// document.getElementById( 'login' ).onclick = async () => { try { await signInWithEmailAndPassword( auth, emailInput.value, passwordInput.value ); } catch ( e ) { showToast( "ログイン失敗: " + e.message ); } };
// document.getElementById( 'signup' ).onclick = async () => { try { await createUserWithEmailAndPassword( auth, emailInput.value, passwordInput.value ); } catch ( e ) { showToast( "サインアップ失敗: " + e.message ); } };
document.getElementById( 'google-login' ).onclick = async () => { try { await signInWithPopup( auth, provider ); } catch ( e ) { showToast( "Googleログイン失敗: " + e.message ); } };
userIcon.onclick = () => { userMenu.style.display = ( userMenu.style.display === 'block' ) ? 'none' : 'block'; }
const switchAccountBtn = document.getElementById( 'switch-account' );
if ( switchAccountBtn ) {
	switchAccountBtn.onclick = async () => {
		userMenu.style.display = 'none';
		try {
			await signInWithPopup( auth, provider );
		} catch ( e ) {
			showToast( "切替失敗" );
		}
	};
}
document.getElementById( 'logout-btn' ).onclick = () => { userMenu.style.display = 'none'; signOut( auth ); location.hash = '#login'; }
document.addEventListener( 'click', e => {
	if ( !userMenu.contains( e.target ) && e.target !== userIcon ) userMenu.style.display = 'none';
	document.querySelectorAll( '.menu-popup' ).forEach( menu => {
		const btn = menu.previousSibling;
		if ( !menu.contains( e.target ) && !btn.contains( e.target ) ) menu.style.display = 'none';
	} );
} );

/* Auth state */
onAuthStateChanged( auth, async user => {
	// ★ ここで「画面を表示していい」と宣言
	document.body.classList.remove( 'auth-loading' );
	if ( !user ) {
		location.hash = '#login';
		show( 'login' );
		return;
	}

	if ( user.photoURL ) userIcon.src = user.photoURL;

	// ★ 必ずここで遷移処理
	if ( !location.hash || location.hash === '#login' ) {
		location.hash = '#/list';
	}

	await navigate(); // ← 必ず呼ぶ
} );
window.addEventListener( 'hashchange', () => {
	if ( !auth.currentUser ) return;
	navigate();
} );

async function loadMetaOnce() {
	if ( metaCache ) return metaCache;

	let metaWasFixed = false;

	const metaRef = doc( db, 'users', auth.currentUser.uid, 'meta', 'main' );
	const snap = await getDoc( metaRef );

	if ( snap.exists() ) {
		metaCache = snap.data();
		if ( !Array.isArray( metaCache.memos ) ) {
			metaCache.memos = [];
			metaWasFixed = true;
		}
	} else {
		metaCache = { memos: [] };
		metaWasFixed = true;
	}

	// 🔁 meta が空なら Firestore から1回だけ復元
	if ( metaCache.memos.length === 0 ) {
		const memosSnap = await getDocs(
			collection( db, 'users', auth.currentUser.uid, 'memos' )
		);

		metaCache.memos = memosSnap.docs.map( d => {
			const m = d.data();
			return {
				id: d.id,
				title: m.title || '',
				updated: m.updated || Date.now(),
				deleted: !!m.deletedAt
			};
		} );

		metaWasFixed = true;
	}

	// 🧠 正規化（壊れたデータ防止）
	metaCache.memos.forEach( m => {
		if ( typeof m.deleted !== 'boolean' ) {
			m.deleted = false;
			metaWasFixed = true;
		}
		if ( typeof m.title !== 'string' ) {
			m.title = '';
			metaWasFixed = true;
		}
		if ( typeof m.updated !== 'number' ) {
			m.updated = Date.now();
			metaWasFixed = true;
		}
	} );

	// ✅ 「直した時だけ」保存
	if ( metaWasFixed ) {
		await setDoc( metaRef, metaCache );
	}

	return metaCache;
}
async function loadMemos() {
	await loadMetaOnce();
	memoList.innerHTML = '';

	metaCache.memos
		.filter( m => !m.deleted )
		.sort( ( a, b ) => b.updated - a.updated )
		.forEach( m => {

			const li = document.createElement( 'li' );

			/* ========== li 全体を覆う a ========== */
			const link = document.createElement('a');
			link.href = `#/editor/${m.id}`;
			link.style.position = 'absolute';
			link.style.top = '0';
			link.style.left = '0';
			link.style.width = '100%';
			link.style.height = '100%';
			link.style.textDecoration = 'none';
			link.style.color = 'inherit';
			link.onclick = e => {
				e.preventDefault();
				location.hash = `#/editor/${m.id}`;
			};
			li.appendChild(link);



			/* =====================
				 左側タイトル
				 ===================== */

			const titleSpan = document.createElement( 'span' );
			titleSpan.className = 'memo-title';
			titleSpan.textContent = m.title || 'Untitled';
			li.appendChild( titleSpan );

			/* =====================
				 右側（日付 + メニュー）
				 ===================== */
			const rightDiv = document.createElement( 'div' );
			rightDiv.className = 'memo-right';

			const dateSpan = document.createElement( 'span' );
			dateSpan.className = 'date-span';
			dateSpan.textContent =
				new Date( m.updated ).toLocaleString( 'ja-JP', {
					year: 'numeric', month: '2-digit', day: '2-digit',
					hour: '2-digit', minute: '2-digit'
				} );

			/* ⋯ メニュー */
			const menuBtn = document.createElement( 'button' );
			menuBtn.textContent = '　⁝';
			menuBtn.className = 'menu-btn';

			const menuPopup = document.createElement( 'div' );
			menuPopup.className = 'menu-popup';

			const copyBtn = document.createElement( 'button' );
			copyBtn.textContent = '❐';
			copyBtn.onclick = async ( e ) => {
				e.stopPropagation();// li / a のクリックを止める
				const snap = await getDoc(
					doc( db, 'users', auth.currentUser.uid, 'memos', m.id )
				);
				navigator.clipboard.writeText( snap.data()?.content || '' );
				showToast( 'Copied' );
				menuPopup.style.display = 'none';
			};

			const delBtn = document.createElement( 'button' );
			delBtn.textContent = '🗑️';
			delBtn.onclick = async ( e ) => {
				e.stopPropagation();
				m.deleted = true;
				m.updated = Date.now();
				await saveMeta();
				loadMemos();
				showToast( 'Moved to Trash' );
				menuPopup.style.display = 'none';
			};

			menuPopup.append( copyBtn, delBtn );
			menuBtn.onclick = e => {
				e.stopPropagation();
				menuPopup.style.display =
					menuPopup.style.display === 'block' ? 'none' : 'block';
			};

			rightDiv.append( dateSpan, menuBtn, menuPopup );
			/* =====================
	 aタグの中に右側も入れる
	 ===================== */
			li.appendChild( rightDiv );
			/* =====================
	 li に a を追加
	 ===================== */
			memoList.appendChild( li );
		} );
}

/* Trash表示 */
function loadTrash() {
	if ( !metaCache || !Array.isArray( metaCache.memos ) ) return;
	trashList.innerHTML = '';

	metaCache.memos
		.filter( m => m.deleted )
		.sort( ( a, b ) => b.updated - a.updated )
		.forEach( m => {
			const li = document.createElement( 'li' );

/* ========== li 全体を覆う a ========== */
			const link = document.createElement('a');
			link.href = `#/editor/${m.id}`;
			link.style.position = 'absolute';
			link.style.top = '0';
			link.style.left = '0';
			link.style.width = '100%';
			link.style.height = '100%';
			link.style.textDecoration = 'none';
			link.style.color = 'inherit';
			link.onclick = e => {
				e.preventDefault();
				location.hash = `#/editor/${m.id}`;
			};
			li.appendChild(link);

						/* =====================
				 左側タイトル
				 ===================== */

			const titleSpan = document.createElement( 'span' );
			titleSpan.className = 'memo-title';
			titleSpan.textContent = m.title || 'Untitled';
			li.appendChild( titleSpan );

			// 右側の操作領域
/* =====================
				 右側（日付 + メニュー）
				 ===================== */
			const rightDiv = document.createElement( 'div' );
			rightDiv.className = 'memo-right';

			const dateSpan = document.createElement( 'span' );
			dateSpan.className = 'date-span';
			dateSpan.textContent =
				new Date( m.updated ).toLocaleString( 'ja-JP', {
					year: 'numeric', month: '2-digit', day: '2-digit',
					hour: '2-digit', minute: '2-digit'
				} );

			// 復元ボタン
			const restoreBtn = document.createElement( 'button' );
			restoreBtn.textContent = '↩️';
			restoreBtn.className = 'menu-btn';
			restoreBtn.onclick = async e => {
				e.stopPropagation();
				await updateMeta( m.id, { deleted: false, updated: Date.now() } );
				loadTrash();
				await loadMemos(); // メモ一覧も更新
			};

			// ⋯ メニュー
			const menuBtn = document.createElement( 'button' );
			menuBtn.textContent = '❌';
			menuBtn.className = 'menu-btn';

			const menuPopup = document.createElement( 'div' );
			menuPopup.className = 'menu-popup';

			// 完全削除ボタン
			const delBtn = document.createElement( 'button' );
			delBtn.textContent = 'Delete Permanently';
			delBtn.onclick = async e => {
				e.stopPropagation();
				// Firestoreのドキュメントを削除
				 await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'memos', m.id));
				// meta からも削除
				metaCache.memos = metaCache.memos.filter( mm => mm.id !== m.id );
				await saveMeta();
				loadTrash();
				showToast( 'Deleted permanently' );
			};

			menuPopup.appendChild( delBtn );
			menuBtn.onclick = e => {
				e.stopPropagation();
				menuPopup.style.display =
					menuPopup.style.display === 'block' ? 'none' : 'block';
			};

			// 右側 div に追加（順序：日付 → 復元 → メニュー）
			rightDiv.append( dateSpan, restoreBtn, menuBtn, menuPopup );
			li.appendChild( rightDiv );

			trashList.appendChild( li );
		} );
}
async function openEditor( id ) {
	currentMemoId = id;

	if ( memoCache[id] ) {
		showEditor( memoCache[id] );
		return;
	}

	const snap = await getDoc( doc( db, 'users', auth.currentUser.uid, 'memos', id ) );
	const data = snap.data();
	memoCache[id] = data;
	showEditor( data );
}

// function showEditor(data){
//   titleInput.value=data.title||'';
//   editor.innerHTML=data.content||'';
//   show('editor');
// }

function showEditor( data ) {
	titleInput.value = data.title || '';
	editor.innerHTML = data.content || '<br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br><br>';
	show( 'editor' );
}
let saveTimer = null;

function debounceSave() {
	clearTimeout( saveTimer );
	saveTimer = setTimeout( saveMemo, 500 );
}

titleInput.addEventListener( 'input', debounceSave );
editor.addEventListener( 'input', debounceSave );

async function saveMemo() {
	if ( !currentMemoId ) return;

	const title =
		titleInput.value.trim() ||
		editor.innerText.split( '\n' )[0]?.trim() || '';

	const content = editor.innerHTML;
	const updated = Date.now();

	memoCache[currentMemoId] = { title, content, updated };

	await setDoc(
		doc( db, 'users', auth.currentUser.uid, 'memos', currentMemoId ),
		{ title, content, updated },
		{ merge: true }
	);

	await updateMeta( currentMemoId, { title, updated } );
}

async function saveMeta() {
	await setDoc(
		doc( db, 'users', auth.currentUser.uid, 'meta', 'main' ),
		metaCache
	);
}

function getMeta( id ) {
	return metaCache.memos.find( m => m.id === id );
}

async function updateMeta( id, fields ) {
	const m = getMeta( id );
	if ( !m ) return;
	Object.assign( m, fields );
	await saveMeta();
}
// updateMeta(currentMemoId, title);


/* Paste処理（Base64 直接保存版） */
editor.addEventListener( 'paste', async e => {
	e.preventDefault();
	const range = document.getSelection().getRangeAt( 0 );
	const items = e.clipboardData.items || [];
	const files = e.clipboardData.files || [];

	async function processFile( file ) {
		const img = new Image();
		img.src = URL.createObjectURL( file );
		await img.decode(); // 画像読み込み完了まで待つ

		// リサイズ
		const maxWidth = 1024;
		let width = img.width;
		let height = img.height;
		if ( width > maxWidth ) {
			height = ( height / width ) * maxWidth;
			width = maxWidth;
		}

		const canvas = document.createElement( 'canvas' );
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext( '2d' );
		ctx.drawImage( img, 0, 0, width, height );

		// Canvas → Blob に変換
		const blob = await new Promise( resolve => canvas.toBlob( resolve, 'image/jpeg', 0.8 ) );

		// Blob → URL
		const blobUrl = URL.createObjectURL( blob );

		// 挿入
		const imgEl = document.createElement( 'img' );
		imgEl.src = blobUrl;
		range.insertNode( imgEl );
		range.collapse( false );

		saveMemo();
	}

	// クリップボードの items から画像を探す
	for ( const item of items ) {
		if ( item.type.startsWith( 'image/' ) ) {
			const file = item.getAsFile();
			await processFile( file );
			return;
		}
	}

	// files から画像を探す
	if ( files.length > 0 && files[0].type.startsWith( 'image/' ) ) {
		await processFile( files[0] );
		return;
	}

	// 2️⃣ テキスト処理
	const text = e.clipboardData.getData( 'text/plain' );
	const url = text.trim();

	// helper: insert element and collapse
	const insertEl = ( el ) => { range.insertNode( el ); range.collapse( false ); saveMemo(); };

	// 2-1. YouTube
	let yt = url.match( /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]+)/ );
	if ( yt ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'video';
		const iframe = document.createElement( 'iframe' );
		iframe.src = `https://www.youtube-nocookie.com/embed/${yt[1]}?modestbranding=1&rel=0&playsinline=1`;
		iframe.allowFullscreen = true;
		wrap.appendChild( iframe );
		insertEl( wrap );
		return;
	}

	// 2-2. ニコニコ動画
	// ニコニコ動画
	// ニコニコ動画
	let nico = url.match( /nicovideo\.jp\/watch\/([\w]+)/ );
	if ( nico ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'video'; // YouTubeと同じクラス

		const iframe = document.createElement( 'iframe' );
		iframe.src = `https://embed.nicovideo.jp/watch/${nico[1]}`;
		iframe.setAttribute( 'frameborder', '0' );
		iframe.setAttribute( 'allowfullscreen', '' ); // ここが重要
		iframe.setAttribute( 'allow', 'fullscreen' );
		wrap.appendChild( iframe );

		insertEl( wrap );
		return;
	}
	// TikTok
	const tiktok = url.match( /tiktok\.com\/.*\/video\/(\d+)/ );
	if ( tiktok ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'tiktok';
		const iframe = document.createElement( 'iframe' );
		iframe.src = `https://www.tiktok.com/embed/${tiktok[1]}`;
		iframe.allow = "autoplay; fullscreen";
		iframe.allowFullscreen = true;
		wrap.appendChild( iframe );
		insertEl( wrap );
		return;
	}
	// Twitter / X
	const tw = url.match( /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[\w@]+\/status\/(\d+)/i );
	if ( tw ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'twitter';
		const blockquote = document.createElement( 'blockquote' );
		blockquote.className = 'twitter-tweet';
		const a = document.createElement( 'a' );
		a.href = url.replace( /^https?:\/\/(www\.)?x\.com\//i, 'https://twitter.com/' );
		blockquote.appendChild( a );
		wrap.appendChild( blockquote );
		insertEl( wrap );
		if ( window.twttr && window.twttr.widgets ) window.twttr.widgets.load( wrap );
		return;
	}

	// Instagram
	const insta = url.match( /https?:\/\/(www\.)?instagram\.com\/p\/([\w-]+)/i );
	if ( insta ) {
		const postUrl = `https://www.instagram.com/p/${insta[2]}/`;
		const wrap = document.createElement( 'div' );
		wrap.className = 'instagram';
		const blockquote = document.createElement( 'blockquote' );
		blockquote.className = 'instagram-media';
		blockquote.setAttribute( 'data-instgrm-permalink', postUrl );
		blockquote.setAttribute( 'data-instgrm-version', '14' );
		wrap.appendChild( blockquote );
		insertEl( wrap );
		if ( window.instgrm && window.instgrm.Embeds && window.instgrm.Embeds.process ) {
			window.instgrm.Embeds.process( wrap );
		}
		return;
	}



	// 2-6. 画像

	const imgRegex = /https?:\/\/\S+\.(?:png|jpg|jpeg|gif)/i;
	if ( imgRegex.test( url ) ) {
		const img = document.createElement( 'img' );
		img.src = url;
		img.style.cursor = 'pointer';

		img.addEventListener( 'click', e => {
			e.preventDefault();
			e.stopPropagation(); // ← 超重要
			window.open( url, '_blank', 'noopener' );
		} );

		insertEl( img );
		return;
	}

	//   // 2-8. 通常テキスト
	insertEl( document.createTextNode( url ) );
} );

/* Preview */
function showPreview( id, title, content ) {
	previewContent.innerHTML = `<strong>${title}</strong><br>${content}`;
	preview.style.display = 'block';
	copyBtn.onclick = () => { navigator.clipboard.writeText( content || '' ); showToast( 'Copied' ); }
	deleteBtn.onclick = async () => {
		await updateMeta( id, { deleted: true, updated: Date.now() } );
		preview.style.display = 'none';
		showToast( 'Moved to Trash' );
		loadMemos(); // ← これ
	}
	closePreview.onclick = () => preview.style.display = 'none';
}

document.getElementById( 'go-trash' ).onclick = () => { location.hash = '#/trash'; }
document.getElementById( 'back-list' ).onclick = () => { location.hash = '#/list'; }
document.getElementById( 'back' ).onclick = () => { if ( history.length > 1 ) history.back(); else location.hash = '#/list'; }
/* New memo button */
document.getElementById( 'new-memo' ).onclick = async () => {
	await loadMetaOnce(); // ← 必ず先に呼ぶ
	// 本文ドキュメントを1件だけ作る
	const ref = await addDoc(
		collection( db, 'users', auth.currentUser.uid, 'memos' ),
		{ title: '', content: '', updated: Date.now() }
	);

	// meta（目次箱）に追加
	metaCache.memos.push( {
		id: ref.id,
		title: '',
		updated: Date.now(),
		deleted: false
	} );

	// meta保存
	await setDoc(
		doc( db, 'users', auth.currentUser.uid, 'meta', 'main' ),
		metaCache
	);

	// エディタへ
	location.hash = `#/editor/${ref.id}`;
};
/* Navigation */
async function navigate() {
	if ( !auth.currentUser ) {
		show( 'login' );
		return;
	}

	const hash = location.hash;

	if ( hash.startsWith( '#/editor/' ) ) {
		await loadMetaOnce();           // editor だけ
		const id = hash.split( '/' )[2];
		if ( id ) await openEditor( id );

	} else if ( hash === '#/trash' ) {
		await loadMetaOnce();           // trash だけ
		show( 'trash' );
		loadTrash();

		// ★ Empty Trash ボタンの設定 ★
	const emptyTrashBtn = document.getElementById('empty-trash-btn');
	if (emptyTrashBtn) {
		emptyTrashBtn.onclick = async () => {
			if (!metaCache || !Array.isArray(metaCache.memos)) return;

			// ★ 確認ダイアログ ★
		const ok = confirm("Trash内のすべてのメモを完全削除します。本当によろしいですか？");
		if (!ok) return; // キャンセルなら何もしない

			const trashMemos = metaCache.memos.filter(m => m.deleted);
			for (const m of trashMemos) {
				 // 完全削除
      await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'memos', m.id));
    }


			// meta からも削除
			metaCache.memos = metaCache.memos.filter(m => !m.deleted);
			await saveMeta();

			loadTrash();
			showToast('Trash emptied');
		};
	}

	} else {
		await loadMetaOnce();           // list だけ
		show( 'list' );
		await loadMemos();
	}
}
