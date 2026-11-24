/**
 * Overview trend chart component (ECharts).
 * Mount: OverviewTrendChart.mount(el, props)
 * Update: instance.update(props)
 * Destroy: instance.destroy()
 */
(function (global) {
  function niceMax(value) {
    const v = Math.max(Number(value) || 1, 1);
    const exp = Math.floor(Math.log10(v));
    const base = Math.pow(10, exp);
    const n = v / base;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return nice * base;
  }

  function axisMoney(v) {
    if (v >= 1000) return `¥${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
    if (v >= 100) return `¥${Math.round(v)}`;
    return `¥${Number(v).toFixed(v < 10 ? 1 : 0)}`;
  }

  function axisCount(v) {
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
    return `${Math.round(v)}`;
  }

  function buildOption(props) {
    const {
      categories = [],
      cost = [],
      request = [],
      prevCost = [],
      threshold = 0,
      thresholdLabel = '预算阈值'
    } = props || {};
    const maxCost = niceMax(Math.max(...cost, ...prevCost, threshold, 1) * 1.08);
    const maxReq = niceMax(Math.max(...request, 1) * 1.08);

    return {
      animationDuration: 420,
      animationEasing: 'cubicOut',
      grid: { left: 48, right: 48, top: 28, bottom: 28, containLabel: false },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15,42,54,.92)',
        borderWidth: 0,
        padding: [10, 12],
        textStyle: { color: '#e8f2f0', fontSize: 11 },
        axisPointer: {
          type: 'line',
          lineStyle: { color: 'rgba(79,127,240,.35)', width: 1, type: 'dashed' }
        },
        formatter(params) {
          const rows = (params || []).map(p => {
            const val = p.seriesName.includes('请求')
              ? axisCount(p.value)
              : axisMoney(p.value);
            return `<div style="display:flex;justify-content:space-between;gap:18px;margin-top:4px">
              <span>${p.marker}${p.seriesName}</span><b>${val}</b>
            </div>`;
          }).join('');
          return `<div style="font-weight:700;margin-bottom:4px">${params?.[0]?.axisValueLabel || ''}</div>${rows}`;
        }
      },
      legend: { show: false },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: categories.length ? categories : ['—'],
        axisLine: { lineStyle: { color: '#e6ecee' } },
        axisTick: { show: false },
        axisLabel: {
          show: true,
          color: '#9aa7ae',
          fontSize: 10,
          margin: 12,
          hideOverlap: false,
          interval: 0
        }
      },
      yAxis: [
        {
          type: 'value',
          name: '',
          min: 0,
          max: maxCost,
          splitNumber: 4,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: '#edf1f3', type: 'solid' } },
          axisLabel: {
            color: '#9aa7ae',
            fontSize: 10,
            formatter: (v) => axisMoney(v)
          }
        },
        {
          type: 'value',
          min: 0,
          max: maxReq,
          splitNumber: 4,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: '#9aa7ae',
            fontSize: 10,
            formatter: (v) => axisCount(v)
          }
        }
      ],
      series: [
        {
          name: '对比周期成本',
          type: 'line',
          smooth: 0.35,
          showSymbol: false,
          data: prevCost,
          yAxisIndex: 0,
          lineStyle: { width: 1.5, type: [5, 4], color: '#b7c3cc' },
          z: 2
        },
        {
          name: '请求量',
          type: 'line',
          smooth: 0.4,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 7,
          data: request,
          yAxisIndex: 1,
          lineStyle: { width: 2.2, color: '#12a984' },
          itemStyle: { color: '#12a984', borderColor: '#fff', borderWidth: 2 },
          emphasis: { focus: 'series', scale: true },
          z: 3
        },
        {
          name: '成本',
          type: 'line',
          smooth: 0.4,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 7,
          data: cost,
          yAxisIndex: 0,
          lineStyle: { width: 2.4, color: '#4f7ff0' },
          itemStyle: { color: '#4f7ff0', borderColor: '#fff', borderWidth: 2 },
          areaStyle: {
            color: new global.echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(91,134,240,0.30)' },
              { offset: 0.55, color: 'rgba(91,134,240,0.08)' },
              { offset: 1, color: 'rgba(91,134,240,0)' }
            ])
          },
          emphasis: { focus: 'series' },
          z: 4
        },
        {
          name: thresholdLabel,
          type: 'line',
          markLine: {
            silent: true,
            symbol: 'none',
            label: {
              show: true,
              position: 'insideEndTop',
              formatter: `${thresholdLabel}`,
              color: '#c47a35',
              fontSize: 10,
              fontWeight: 700,
              backgroundColor: '#fff7ef',
              padding: [3, 6],
              borderRadius: 4,
              borderColor: '#f0d2b3',
              borderWidth: 1
            },
            lineStyle: { color: '#e7a05a', width: 1.4, type: [5, 4] },
            data: [{ yAxis: threshold }]
          },
          data: [],
          yAxisIndex: 0,
          z: 1
        }
      ]
    };
  }

  function OverviewTrendChart(el) {
    this.el = el;
    this.chart = null;
    this._onResize = () => {
      if (this.chart) this.chart.resize();
    };
  }

  OverviewTrendChart.prototype.mount = function mount(props) {
    if (!global.echarts) {
      this.el.innerHTML = '<div class="ov-chart-fallback">图表组件未加载（ECharts）</div>';
      return this;
    }
    if (!this.chart) {
      this.chart = global.echarts.init(this.el, null, { renderer: 'canvas' });
      window.addEventListener('resize', this._onResize);
    }
    this.chart.setOption(buildOption(props), true);
    return this;
  };

  OverviewTrendChart.prototype.update = function update(props) {
    return this.mount(props);
  };

  OverviewTrendChart.prototype.destroy = function destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this.chart) {
      this.chart.dispose();
      this.chart = null;
    }
  };

  OverviewTrendChart.mount = function (el, props) {
    const inst = new OverviewTrendChart(el);
    inst.mount(props);
    return inst;
  };

  global.OverviewTrendChart = OverviewTrendChart;
})(window);
