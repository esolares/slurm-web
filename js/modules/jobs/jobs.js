define([
  'jquery',
  'handlebars',
  'text!../../js/modules/jobs/jobs.hbs',
  'text!../../js/modules/jobs/modal-job.hbs',
  'text!../../js/modules/jobs/table-jobs.hbs',
  'token-utils',
  'tablesorter-utils',
  'flot-utils',
  'cluster-utils',
  'tagsinput-utils',
  'jobs-utils',
  'jquery-tablesorter',
  'jquery-flot',
  'jquery-flot-pie',
  'bootstrap',
  'bootstrap-tagsinput',
  'jobs-helpers',
  'boolean-helpers',
  'date-helpers',
  'different-helpers',
], function ($, Handlebars, template, modalTemplate, tableJobsTemplate, tokenUtils, tablesorterUtils, flotUtils, clusterUtils, tagsinputUtils) {
  template = Handlebars.compile(template);
  modalTemplate = Handlebars.compile(modalTemplate);
  tableJobsTemplate = Handlebars.compile(tableJobsTemplate);

  return function (config) {
    var self = this;
    this.interval = null;
    this.tablesorterOptions = {};
    this.tagsinputOptions = [];
    this.onModal = null;

    function filterTableJobs(jobs) {
      var context = {
        count: Object.keys(jobs).length,
        jobs: jobs
      };

      context.jobs = tagsinputUtils.filterJobs(jobs, self.tagsinputOptions);
      $('#table-jobs').html(tableJobsTemplate(context));
      $('.tt-input').css('width', '100%');

      $("tr[id^='tr-job-']").on('click', function (e) {
        e.preventDefault();

        var jobId = $(e.target).parent('tr').attr('id').split('-')[2];
        $(document).trigger('modal-job', { jobId: jobId });
      });

      $("td[data-partition^='partition-'], td[data-qos^='qos-']").on('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        $('input.typeahead').tagsinput('add', $(e.target).attr('data-qos') || $(e.target).attr('data-partition'));
      });
    }

    function closeModal() {
      $('#modal-job').remove();
      $('.modal-backdrop').remove();
      self.onModal = null;
    }

    function toggleModal(jobId) {
      closeModal();
      self.onModal = jobId;

      var options = {
        type: 'POST',
        dataType: 'json',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        data: JSON.stringify({
          token: tokenUtils.getToken(config.cluster)
        })
      };

      $.ajax(config.cluster.api.url + config.cluster.api.path + '/job/' + jobId, options)
        .success(function (job) {
          job.id = jobId;
          var context = {
            job: job
          };

          $('body').append(modalTemplate(context));
          $('#modal-job').on('hidden.bs.modal', closeModal);
          $('#modal-job').modal('show');
        });
    }

    this.init = function () {
      var options = {
        type: 'POST',
        dataType: 'json',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        data: JSON.stringify({
          token: tokenUtils.getToken(config.cluster)
        })
      };

      $(document).on('modal-job', function (e, options) {
        e.stopPropagation();

        toggleModal(options.jobId);
      });

      $.ajax(config.cluster.api.url + config.cluster.api.path + '/jobs', options)
        .success(function (jobs) {
          var context = {
            tagsinputOptions: self.tagsinputOptions.toString()
          };

          var plotParams = {
            series: {
              pie: {
                show: true,
              }
            }
          };

          $('#main').append(template(context));

          if (self.onModal) {
            $(document).trigger('modal-job', { jobId: self.onModal });
          }

          var labels = [];
          var labelsPartitions = [];
          var labelsQOS = [];

          var index;
          for (index in jobs) {
            if (jobs.hasOwnProperty(index)) {
              if (labelsPartitions.indexOf(jobs[index].partition) === -1) {
                labelsPartitions.push(jobs[index].partition);
              }
              if (labelsQOS.indexOf(jobs[index].qos) === -1) {
                labelsQOS.push(jobs[index].qos);
              }
            }
          }

          for (index in labelsPartitions) {
            if (labelsPartitions.hasOwnProperty(index)) {
              labelsPartitions[index] = { text: 'partition-' + labelsPartitions[index], type: 'partition' }
            }
          }

          for (index in labelsQOS) {
            if (labelsQOS.hasOwnProperty(index)) {
              labelsQOS[index] = { text: 'qos-' + labelsQOS[index], type: 'qos' }
            }
          }

          labels = labelsPartitions.concat(labelsQOS)
          $('.typeahead').tagsinput({
            allowDuplicates: false,
            freeInput: false,
            typeaheadjs: {
              hint: true,
              highlight: true,
              minLength: 1,
              source: tagsinputUtils.jobsSubstringMatcher(labels)
            }
          });

          $('input.typeahead').on('itemAdded itemRemoved', function(event) {
            self.tagsinputOptions = tagsinputUtils.getTagsinputOptions('.typeahead');
            filterTableJobs(jobs);
          });

          filterTableJobs(jobs);

          tablesorterUtils.eraseEmptyColumn('.tablesorter');
          $('.tablesorter').tablesorter(self.tablesorterOptions);

          var dataAllocatedCores = [
            {
              label: 'allocated',
              data: 0
            }, {
              label: 'idle',
              data: 0
            }
          ];

          var QOSStats = {};
          var partStats = {};

          var index;
          var job;
          for (index in jobs) {
            if (jobs.hasOwnProperty(index)) {
              job = jobs[index];

              if (job.hasOwnProperty('job_state') &&
                  job.hasOwnProperty('qos') &&
                  job.hasOwnProperty('partition') &&
                  (job.job_state === 'RUNNING' || job.job_state === 'COMPLETED')) {
                if (!QOSStats.hasOwnProperty(job.qos)) {
                  QOSStats[job.qos] = { cores: 0, nodes: 0 };
                }
                if (!partStats.hasOwnProperty(job.partition)) {
                  partStats[job.partition] = { cores: 0, nodes: 0 };
                }
                if (job.hasOwnProperty('num_cpus')) {
                  QOSStats[job.qos].cores += job.num_cpus;
                  partStats[job.partition].cores += job.num_cpus;
                  dataAllocatedCores[0].data += job.num_cpus;
                }
                if (job.hasOwnProperty('num_nodes')) {
                  QOSStats[job.qos].nodes += job.num_nodes;
                  partStats[job.partition].nodes += job.num_nodes;
                }
              }
            }
          }

          dataAllocatedCores[1].data += clusterUtils.getClusterSync(config).cores - dataAllocatedCores[0].data;

          var dataQOSNodes = [];
          var dataQOSCores = [];

          var QOS;
          for (QOS in QOSStats) {
            if (QOSStats.hasOwnProperty(QOS)) {
              dataQOSNodes.push({ label: QOS, data: QOSStats[QOS].nodes });
              dataQOSCores.push({ label: QOS, data: QOSStats[QOS].cores });
            }
          }

          var dataPartNodes = [];
          var dataPartCores = [];

          var part;
          for (part in partStats) {
            if (partStats.hasOwnProperty(part)) {
              dataPartNodes.push({ label: part, data: partStats[part].nodes });
              dataPartCores.push({ label: part, data: partStats[part].cores });
            }
          }

          dataAllocatedCores = flotUtils.addPercentInLegend(dataAllocatedCores);
          dataPartNodes = flotUtils.addPercentInLegend(dataPartNodes);
          dataPartCores = flotUtils.addPercentInLegend(dataPartCores);
          dataQOSNodes = flotUtils.addPercentInLegend(dataQOSNodes);
          dataQOSCores = flotUtils.addPercentInLegend(dataQOSCores);

          $.plot('#plot-alloc-cores', dataAllocatedCores, plotParams);
          $.plot('#plot-part-nodes', dataPartNodes, plotParams);
          $.plot('#plot-part-cores', dataPartCores, plotParams);
          $.plot('#plot-qos-nodes', dataQOSNodes, plotParams);
          $.plot('#plot-qos-cores', dataQOSCores, plotParams);
        });
    };

    this.refresh = function () {
      var self = this;

      this.interval = setInterval(function () {
        self.tablesorterOptions = tablesorterUtils.findTablesorterOptions('.tablesorter');
        self.tagsinputOptions = tagsinputUtils.getTagsinputOptions('.typeahead');
        self.destroy(false);
        self.init();
      }, config.REFRESH);
    };

    this.destroy = function (destroyInterval) {
      if (this.interval && destroyInterval) {
        clearInterval(this.interval);
      }

      $('#modal-job').remove();
      $('.modal-backdrop').remove();
      $(document).off('modal-job');
      $("tr[id^='tr-job-']").off('click');
      $("td[data-partition^='partition-'], td[data-qos^='qos-']").off('click');
      $('#apply-tags').off('click');
      $('#jobs').remove();
    };

    return this;
  };
});
