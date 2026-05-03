// ==========================================
// SHRINK WRAP DOCS — SHARED NAVIGATION JS
// ==========================================

(function() {
    'use strict';

    // ---- Theme System ----
    const sunIcon = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    const moonIcon = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';

    function getTimeBasedTheme() {
        const hour = new Date().getHours();
        return (hour >= 7 && hour < 19) ? 'light' : 'dark';
    }

    function setTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        const icon = document.getElementById('docsThemeIcon');
        const label = document.getElementById('docsThemeLabel');
        if (icon) icon.innerHTML = theme === 'light' ? moonIcon : sunIcon;
        if (label) label.textContent = theme === 'light' ? 'Light' : 'Dark';
        localStorage.setItem('shrinkwrap-theme', theme);
    }

    // Initialize theme
    const savedTheme = localStorage.getItem('shrinkwrap-theme');
    setTheme(savedTheme || getTimeBasedTheme());

    // Bind toggle
    const toggleBtn = document.getElementById('docsThemeToggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            const current = document.body.getAttribute('data-theme');
            setTheme(current === 'light' ? 'dark' : 'light');
        });
    }

    // ---- Sidebar Toggle (Mobile) ----
    const sidebar = document.querySelector('.docs-sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');

    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', function() {
            sidebar.classList.toggle('open');
        });

        // Close sidebar when clicking a link (mobile)
        sidebar.querySelectorAll('a').forEach(function(link) {
            link.addEventListener('click', function() {
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('open');
                }
            });
        });

        // Close sidebar on outside click (mobile)
        document.addEventListener('click', function(e) {
            if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
                if (!sidebar.contains(e.target) && e.target !== sidebarToggle && !sidebarToggle.contains(e.target)) {
                    sidebar.classList.remove('open');
                }
            }
        });
    }

    // ---- Active Section Tracking (scroll spy) ----
    function updateActiveSection() {
        const sections = document.querySelectorAll('.docs-content h2[id], .docs-content h3[id]');
        const sublinks = document.querySelectorAll('.sidebar-sublink');
        if (!sections.length || !sublinks.length) return;

        let activeId = '';
        const scrollTop = window.scrollY + 100;

        sections.forEach(function(section) {
            if (section.offsetTop <= scrollTop) {
                activeId = section.id;
            }
        });

        sublinks.forEach(function(link) {
            const href = link.getAttribute('href');
            if (href && href.includes('#' + activeId)) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    let scrollTimer;
    window.addEventListener('scroll', function() {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(updateActiveSection, 50);
    });

    // Initial call
    updateActiveSection();

})();
