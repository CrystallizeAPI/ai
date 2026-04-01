export const physicsScript = /* js */ `
(function() {
    var Engine = Matter.Engine,
        Runner = Matter.Runner,
        Bodies = Matter.Bodies,
        Body = Matter.Body,
        Composite = Matter.Composite,
        Events = Matter.Events;

    var W = window.innerWidth;
    var H = window.innerHeight;
    var canvas = document.getElementById('pinball');
    canvas.width = W;
    canvas.height = H;

    var engine = Engine.create({ gravity: { x: 0, y: 0.6 } });
    var world = engine.world;

    var wallT = 60;
    var walls = [
        Bodies.rectangle(W / 2, -wallT / 2, W + wallT * 2, wallT, { isStatic: true, render: { visible: false } }),
        Bodies.rectangle(W / 2, H + wallT / 2, W + wallT * 2, wallT, { isStatic: true, render: { visible: false } }),
        Bodies.rectangle(-wallT / 2, H / 2, wallT, H + wallT * 2, { isStatic: true, render: { visible: false } }),
        Bodies.rectangle(W + wallT / 2, H / 2, wallT, H + wallT * 2, { isStatic: true, render: { visible: false } })
    ];
    Composite.add(world, walls);

    /* ── Feature bodies (synced to HTML cards) ──────── */
    var featureBodies = [];
    var contentEl = document.getElementById('content');
    function syncFeatures() {
        featureBodies.forEach(function(b) { Composite.remove(world, b); });
        featureBodies = [];
        var cards = document.querySelectorAll('.feature-card');
        cards.forEach(function(card, i) {
            var r = card.getBoundingClientRect();
            var b = Bodies.rectangle(r.left + r.width/2, r.top + r.height/2, r.width, r.height, {
                isStatic: true, restitution: 1.3, label: 'feature-' + i, plugin: { idx: i }
            });
            Composite.add(world, b);
            featureBodies.push(b);
        });
    }
    setTimeout(syncFeatures, 300);
    var scrollTimer;
    contentEl.addEventListener('scroll', function() {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(syncFeatures, 50);
    });

    /* ── Product images ──────────────────────────────── */
    var CDN = 'https://crystallize.com/minigames/pricing/';
    var productNames = [
        'burger','cheddar','chili','donut','flour','gauda',
        'hotdog','pizza','shoe','tee-blue','tee-pink',
        'tomato','unicorn'
    ];
    var productImages = {};
    var imagesLoaded = 0;
    productNames.forEach(function(name) {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() { imagesLoaded++; };
        img.src = CDN + name + '.png';
        productImages[name] = img;
    });

    var MAX_PRODUCTS = 30;
    var products = [];

    function spawnProduct(x, y, vx, vy) {
        if (products.length >= MAX_PRODUCTS) {
            var old = products.shift();
            Composite.remove(world, old);
        }
        var name = productNames[Math.floor(Math.random() * productNames.length)];
        var size = 20 + Math.random() * 12;
        var p = Bodies.circle(x, y, size, {
            restitution: 0.7,
            friction: 0.05,
            frictionAir: 0.005,
            render: { visible: false },
            label: 'product',
            plugin: { imgName: name, size: size }
        });
        Body.setVelocity(p, { x: vx || 0, y: vy || 0 });
        Body.setAngularVelocity(p, (Math.random() - 0.5) * 0.1);
        Composite.add(world, p);
        products.push(p);
        return p;
    }

    /* ── Slingshot ────────────────────────────────────── */
    var sling = { active: false, sx: 0, sy: 0, mx: 0, my: 0 };

    canvas.addEventListener('pointerdown', function(e) {
        sling.active = true;
        sling.sx = e.clientX;
        sling.sy = e.clientY;
        sling.mx = e.clientX;
        sling.my = e.clientY;
    });
    canvas.addEventListener('pointermove', function(e) {
        if (!sling.active) return;
        sling.mx = e.clientX;
        sling.my = e.clientY;
    });
    window.addEventListener('pointerup', function(e) {
        if (!sling.active) return;
        sling.active = false;
        var dx = sling.sx - sling.mx;
        var dy = sling.sy - sling.my;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 10) return;
        var power = Math.min(dist / 8, 25);
        var nx = dx / dist;
        var ny = dy / dist;
        spawnProduct(sling.sx, sling.sy, nx * power, ny * power);
    });

    /* ── Collision → animate HTML cards ────────────── */
    var hitTimers = [];
    Events.on(engine, 'collisionStart', function(event) {
        event.pairs.forEach(function(pair) {
            [pair.bodyA, pair.bodyB].forEach(function(b) {
                if (b.label && b.label.indexOf('feature-') === 0) {
                    var idx = b.plugin.idx;
                    var card = document.querySelectorAll('.feature-card')[idx];
                    if (!card) return;
                    card.classList.add('hit');
                    clearTimeout(hitTimers[idx]);
                    hitTimers[idx] = setTimeout(function() { card.classList.remove('hit'); }, 600);
                }
            });
        });
    });

    /* ── Render ───────────────────────────────────────── */
    var ctx = canvas.getContext('2d');
    var runner = Runner.create();
    Runner.run(runner, engine);

    function draw() {
        ctx.clearRect(0, 0, W, H);

        /* Products */
        Composite.allBodies(world).forEach(function(b) {
            if (b.label !== 'product') return;
            var p = b.plugin;
            var img = productImages[p.imgName];
            if (!img || !img.complete || !img.naturalWidth) return;
            var drawSize = p.size * 2.2;
            ctx.save();
            ctx.translate(b.position.x, b.position.y);
            ctx.rotate(b.angle);
            ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
            ctx.restore();
        });

        /* Draw slingshot aim line */
        if (sling.active) {
            var dx = sling.sx - sling.mx;
            var dy = sling.sy - sling.my;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 10) {
                var nx = dx / dist;
                var ny = dy / dist;
                var len = Math.min(dist, 200);

                ctx.save();
                ctx.setLineDash([6, 8]);
                ctx.lineDashOffset = -performance.now() / 40;
                ctx.beginPath();
                ctx.moveTo(sling.sx, sling.sy);
                ctx.lineTo(sling.sx + nx * len, sling.sy + ny * len);
                ctx.strokeStyle = 'rgba(255,191,74,0.7)';
                ctx.lineWidth = 2;
                ctx.stroke();

                /* Arrow head */
                ctx.setLineDash([]);
                var ax = sling.sx + nx * len;
                var ay = sling.sy + ny * len;
                var angle = Math.atan2(ny, nx);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(ax - 10 * Math.cos(angle - 0.4), ay - 10 * Math.sin(angle - 0.4));
                ctx.moveTo(ax, ay);
                ctx.lineTo(ax - 10 * Math.cos(angle + 0.4), ay - 10 * Math.sin(angle + 0.4));
                ctx.strokeStyle = 'rgba(255,191,74,0.7)';
                ctx.lineWidth = 2;
                ctx.stroke();

                /* Spawn preview */
                var previewName = productNames[Math.floor(performance.now() / 2000) % productNames.length];
                var previewImg = productImages[previewName];
                if (previewImg && previewImg.complete && previewImg.naturalWidth) {
                    ctx.globalAlpha = 0.45;
                    ctx.drawImage(previewImg, sling.sx - 20, sling.sy - 20, 40, 40);
                    ctx.globalAlpha = 1;
                }

                ctx.restore();
            }
        }

        requestAnimationFrame(draw);
    }
    draw();

    /* ── Resize ──────────────────────────────────────── */
    var resizeTimeout;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function() {
            var newW = window.innerWidth;
            var newH = window.innerHeight;
            canvas.width = newW;
            canvas.height = newH;

            /* Update walls */
            Body.setPosition(walls[0], { x: newW / 2, y: -wallT / 2 });
            Body.setVertices(walls[0], Bodies.rectangle(newW / 2, -wallT / 2, newW + wallT * 2, wallT).vertices);
            Body.setPosition(walls[1], { x: newW / 2, y: newH + wallT / 2 });
            Body.setVertices(walls[1], Bodies.rectangle(newW / 2, newH + wallT / 2, newW + wallT * 2, wallT).vertices);
            Body.setPosition(walls[2], { x: -wallT / 2, y: newH / 2 });
            Body.setVertices(walls[2], Bodies.rectangle(-wallT / 2, newH / 2, wallT, newH + wallT * 2).vertices);
            Body.setPosition(walls[3], { x: newW + wallT / 2, y: newH / 2 });
            Body.setVertices(walls[3], Bodies.rectangle(newW + wallT / 2, newH / 2, wallT, newH + wallT * 2).vertices);

            syncFeatures();

            W = newW;
            H = newH;
        }, 100);
    });
})();
`;
